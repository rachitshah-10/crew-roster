"""Persistence layer: migrations, concurrency guarantees and database selection.
Runs on SQLite by default and on PostgreSQL when CREWCHECK_TEST_DATABASE_URL is set."""
import json
import os
import sqlite3
import threading

import pytest
from alembic import command
from alembic.config import Config
from fastapi.testclient import TestClient
from sqlalchemy import event, insert, inspect

from app.main import create_app, database_url
from app.repository import MIGRATIONS, Conflict, Repository, engine_for
from app.schema import rule_versions
from app.storage import now

ON_POSTGRES = bool(os.getenv("CREWCHECK_TEST_DATABASE_URL"))
RULES = {"name": "Set", "rules": []}

# Schema exactly as CrewCheck created it before Alembic (app/storage.py, user_version=2).
LEGACY_SCHEMA = '''
CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT UNIQUE NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('scheduler','manager')), password_hash TEXT NOT NULL);
CREATE TABLE sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), csrf TEXT NOT NULL, expires REAL NOT NULL);
CREATE TABLE login_attempts (address TEXT PRIMARY KEY, count INTEGER NOT NULL, window_start REAL NOT NULL);
CREATE TABLE rule_versions (id INTEGER PRIMARY KEY AUTOINCREMENT, created_at TEXT NOT NULL,
  created_by TEXT REFERENCES users(id), reason TEXT NOT NULL, rules_json TEXT NOT NULL);
CREATE TABLE uploads (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES users(id), filename TEXT NOT NULL,
  file_hash TEXT NOT NULL, created_at TEXT NOT NULL, rule_version INTEGER NOT NULL REFERENCES rule_versions(id), rows_json TEXT NOT NULL);
CREATE TABLE runs (id TEXT PRIMARY KEY, upload_id TEXT UNIQUE NOT NULL REFERENCES uploads(id), created_at TEXT NOT NULL, result_json TEXT NOT NULL);
CREATE TABLE import_attempts (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES users(id), filename TEXT NOT NULL,
  created_at TEXT NOT NULL, size INTEGER NOT NULL, file_hash TEXT, stored INTEGER NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('accepted','rejected','needs_setup')), upload_id TEXT REFERENCES uploads(id), row_count INTEGER,
  options_json TEXT NOT NULL, errors_json TEXT NOT NULL, import_options_json TEXT);
CREATE INDEX upload_owner ON uploads(owner_id);
CREATE INDEX run_time ON runs(created_at);
PRAGMA user_version=2;
'''


@pytest.fixture
def repo(tmp_path):
    repository = Repository(database_url(tmp_path / 'repo.db'))
    repository.migrate()
    repository.seed([{"id": "manager", "name": "M", "email": "m@x", "role": "manager", "password": "pw"}], RULES, now(), lambda p: "hash")
    return repository


def login(client, role='manager'):
    password = 'ManagerDemo!2026' if role == 'manager' else 'SchedulerDemo!2026'
    response = client.post('/api/auth/login', json={'email': role + '@crewcheck.local', 'password': password})
    client.headers['X-CSRF-Token'] = response.json()['csrf']


@pytest.mark.skipif(ON_POSTGRES, reason='adopting a pre-Alembic file only applies to SQLite')
def test_existing_sqlite_database_is_adopted_without_data_loss(tmp_path):
    path = tmp_path / 'old.db'
    with sqlite3.connect(path) as db:
        db.executescript(LEGACY_SCHEMA)
        db.execute("INSERT INTO users VALUES ('legacy','Lee Legacy','legacy@crewcheck.local','scheduler','x:y')")
        db.execute("INSERT INTO rule_versions(created_at,created_by,reason,rules_json) VALUES ('2026-01-01T00:00:00Z',NULL,'Old',?)",
                   (json.dumps({'name': 'Old rules', 'max_duty_hours': 12, 'min_rest_hours': 10, 'certification_at': 'end'}),))
        db.execute("INSERT INTO uploads VALUES ('a'||hex(randomblob(11)),'legacy','old.csv','h','2026-01-02T00:00:00Z',1,'[]')")
    app = create_app(path)
    tables = set(inspect(app.state.repo.engine).get_table_names())
    assert {'alembic_version', 'users', 'import_attempts'} <= tables
    with TestClient(app) as c:
        login(c)
        assert c.get('/api/rules').json()['name'] == 'Old rules'
        saved = c.post('/api/rules', json={'expected_version': 1, 'name': 'New rules', 'reason': 'After migration',
                                           'rules': c.get('/api/rules').json()['rules']})
        assert saved.json()['version'] == 2
    with sqlite3.connect(path) as db:
        assert db.execute("SELECT name FROM users WHERE id='legacy'").fetchone() == ('Lee Legacy',)
        assert db.execute("SELECT COUNT(*) FROM uploads").fetchone() == (1,)
    create_app(path)  # migrating again is a no-op


def test_concurrent_rule_saves_have_one_winner(repo):
    results, barrier = [], threading.Barrier(4)

    def save(n):
        barrier.wait()
        try:
            results.append(repo.add_rule_version(1, "manager", f"save {n}", RULES, now())["id"])
        except Conflict:
            results.append("conflict")
    threads = [threading.Thread(target=save, args=(n,)) for n in range(4)]
    for t in threads: t.start()
    for t in threads: t.join()
    assert sorted(results, key=str) == [2, "conflict", "conflict", "conflict"]
    assert [r["id"] for r in repo.rule_versions()] == [2, 1]


def test_stale_rule_version_is_a_conflict(repo):
    repo.add_rule_version(1, "manager", "first", RULES, now())
    with pytest.raises(Conflict):
        repo.add_rule_version(1, "manager", "stale", RULES, now())
    with pytest.raises(Conflict):
        repo.add_rule_version(7, "manager", "from the future", RULES, now())


def test_version_number_taken_during_save_is_a_conflict(repo):
    """Simulates a writer that claims the next version number between our check and
    our insert, so the primary-key safety net is exercised on every database."""
    claimed = []

    @event.listens_for(repo.engine, "before_cursor_execute")
    def claim_first(conn, cursor, statement, *args):
        if statement.startswith("INSERT INTO rule_versions") and not claimed:
            claimed.append(True)
            conn.execute(insert(rule_versions).values(id=2, created_at=now(), created_by="manager", reason="won", rules_json="{}"))
    with pytest.raises(Conflict):
        repo.add_rule_version(1, "manager", "lost", RULES, now())
    assert claimed
    event.remove(repo.engine, "before_cursor_execute", claim_first)
    assert [v["reason"] for v in repo.rule_versions()] == ["Initial illustrative rules. Not an FAA/EASA compliance profile."]  # rolled back


@pytest.mark.skipif(not ON_POSTGRES, reason='SQLite serializes writers with BEGIN IMMEDIATE, so this interleaving cannot occur')
def test_postgres_race_on_version_number_is_a_conflict(repo):
    other = engine_for(repo.url)
    fired = []

    @event.listens_for(repo.engine, "before_cursor_execute")
    def sneak_in(conn, cursor, statement, *args):
        if statement.startswith("INSERT INTO rule_versions") and not fired:
            fired.append(True)
            with other.begin() as db:
                db.execute(insert(rule_versions).values(id=2, created_at=now(), created_by="manager", reason="won", rules_json="{}"))
    with pytest.raises(Conflict):
        repo.add_rule_version(1, "manager", "lost", RULES, now())
    other.dispose()


def test_duplicate_run_returns_the_first(tmp_path):
    app = create_app(tmp_path / 'runs.db')
    repo = app.state.repo
    with TestClient(app) as c:
        login(c)
        upload = c.post('/api/uploads', files={'file': ('s.csv', b'crew_id,crew_name,role,duty_id,duty_start,duty_end,certification_expires_at\n'
                                                                b'C1,N,pilot,D1,2026-11-09T06:00:00Z,2026-11-09T10:00:00Z,\n')}).json()
    first = repo.add_run({"id": "a" * 24, "upload_id": upload["id"], "created_at": now(), "result_json": "{}"})
    second = repo.add_run({"id": "b" * 24, "upload_id": upload["id"], "created_at": now(), "result_json": "{}"})
    assert first["id"] == second["id"] == "a" * 24


def test_failed_login_window_resets(repo):
    repo.record_failed_login("1.2.3.4", 0, 300)
    repo.record_failed_login("1.2.3.4", 10, 300)
    assert repo.login_attempt("1.2.3.4")["count"] == 2
    repo.record_failed_login("1.2.3.4", 400, 300)
    assert repo.login_attempt("1.2.3.4") == {"address": "1.2.3.4", "count": 1, "window_start": 400}


def test_timestamps_strictly_increase():
    stamps = [now() for _ in range(5000)]
    assert stamps == sorted(stamps) and len(set(stamps)) == len(stamps)


def test_database_url_selection(tmp_path, monkeypatch):
    monkeypatch.delenv("CREWCHECK_DATABASE_URL", raising=False)
    monkeypatch.setenv("CREWCHECK_DB", str(tmp_path / 'env' / 'x.db'))
    assert database_url() == f"sqlite:///{(tmp_path / 'env' / 'x.db').resolve()}" and (tmp_path / 'env').is_dir()
    assert database_url(tmp_path / 'arg.db').endswith('arg.db')
    monkeypatch.setenv("CREWCHECK_DATABASE_URL", "postgresql+psycopg://u:p@db:5432/crewcheck")
    assert database_url(tmp_path / 'arg.db') == "postgresql+psycopg://u:p@db:5432/crewcheck"
    assert engine_for(database_url()).dialect.name == "postgresql"   # no connection is opened


def test_migration_cli_upgrade_and_downgrade(tmp_path, monkeypatch):
    url = os.getenv("CREWCHECK_DATABASE_URL") or f"sqlite:///{tmp_path / 'cli.db'}"
    monkeypatch.setenv("CREWCHECK_DATABASE_URL", url)
    config = Config()
    config.set_main_option("script_location", str(MIGRATIONS))
    command.upgrade(config, "head")
    engine = engine_for(url)
    assert "import_attempts" in inspect(engine).get_table_names()
    command.downgrade(config, "base")
    assert set(inspect(engine).get_table_names()) <= {"alembic_version"}
    engine.dispose()


def test_timestamps_break_ties_when_the_clock_does_not_move(monkeypatch):
    from datetime import datetime, timezone
    import app.storage as storage

    class Frozen(datetime):
        @classmethod
        def now(cls, tz=None):
            return datetime(2026, 11, 10, 12, 0, tzinfo=timezone.utc)
    monkeypatch.setattr(storage, "datetime", Frozen)
    monkeypatch.setattr(storage, "_last", None)
    assert [storage.now() for _ in range(3)] == ['2026-11-10T12:00:00Z', '2026-11-10T12:00:00.000001Z', '2026-11-10T12:00:00.000002Z']
