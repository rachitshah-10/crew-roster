"""All database access. The API layer calls these methods and never writes SQL,
so switching database means changing CREWCHECK_DATABASE_URL, e.g.

    sqlite:///data/crewcheck.db                         (default)
    postgresql+psycopg://user:password@host:5432/crewcheck

Methods return plain dicts. Each method is one transaction.
"""
import json
from contextlib import contextmanager
from datetime import timedelta
from pathlib import Path

from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, event, func, insert, select, update, delete
from sqlalchemy.exc import IntegrityError

from .schema import import_attempts, login_attempts, rule_versions, runs, sessions, uploads, users

MIGRATIONS = Path(__file__).resolve().parent / "migrations"


class Conflict(Exception):
    """A concurrent change won; the caller should reload and retry."""


def engine_for(url):
    if url.startswith("sqlite"):
        # isolation_level=None hands transaction control to SQLAlchemy so writes can
        # start with BEGIN IMMEDIATE: concurrent writers then queue instead of failing.
        engine = create_engine(url, connect_args={"timeout": 15, "check_same_thread": False, "isolation_level": None})

        @event.listens_for(engine, "connect")
        def sqlite_pragmas(connection, _):
            cursor = connection.cursor()
            cursor.execute("PRAGMA foreign_keys=ON")
            cursor.execute("PRAGMA journal_mode=WAL")
            cursor.close()

        @event.listens_for(engine, "begin")
        def sqlite_begin(connection):
            connection.exec_driver_sql("BEGIN IMMEDIATE" if connection.get_execution_options().get("write") else "BEGIN")
        return engine
    return create_engine(url, pool_pre_ping=True)


def as_dict(row):
    return dict(row._mapping) if row is not None else None


class Repository:
    def __init__(self, url):
        self.url = url
        self.engine = engine_for(url)

    @contextmanager
    def write(self):
        """A write transaction (BEGIN IMMEDIATE on SQLite; ordinary on PostgreSQL)."""
        with self.engine.connect() as connection:
            connection.execution_options(write=True)
            with connection.begin():
                yield connection

    # ------------------------------------------------------------ setup
    def migrate(self):
        config = Config()
        config.set_main_option("script_location", str(MIGRATIONS))
        with self.engine.begin() as connection:
            config.attributes["connection"] = connection
            command.upgrade(config, "head")

    def seed(self, accounts, default_rules, created_at, hash_password):
        with self.write() as db:
            for account in accounts:
                if not db.execute(select(users.c.id).where(users.c.id == account["id"])).first():
                    password = account.pop("password")
                    db.execute(insert(users).values(**account, password_hash=hash_password(password)))
            if not db.execute(select(rule_versions.c.id).limit(1)).first():
                db.execute(insert(rule_versions).values(id=1, created_at=created_at, created_by="manager",
                                                        reason="Initial illustrative rules. Not an FAA/EASA compliance profile.",
                                                        rules_json=json.dumps(default_rules)))

    # ------------------------------------------------------------ accounts and sessions
    def session_user(self, token_hash, clock):
        query = (select(users.c.id, users.c.name, users.c.email, users.c.role, sessions.c.csrf)
                 .join(users, users.c.id == sessions.c.user_id)
                 .where(sessions.c.token_hash == token_hash, sessions.c.expires > clock))
        with self.engine.connect() as db:
            return as_dict(db.execute(query).first())

    def user_by_email(self, email):
        with self.engine.connect() as db:
            return as_dict(db.execute(select(users).where(users.c.email == email)).first())

    def login_attempt(self, address):
        with self.engine.connect() as db:
            return as_dict(db.execute(select(login_attempts).where(login_attempts.c.address == address)).first())

    def record_failed_login(self, address, clock, window):
        with self.write() as db:
            row = db.execute(select(login_attempts).where(login_attempts.c.address == address)).first()
            if row is None:
                db.execute(insert(login_attempts).values(address=address, count=1, window_start=clock))
            elif clock - row.window_start >= window:
                db.execute(update(login_attempts).where(login_attempts.c.address == address).values(count=1, window_start=clock))
            else:
                db.execute(update(login_attempts).where(login_attempts.c.address == address).values(count=login_attempts.c.count + 1))

    def start_session(self, address, user_id, token_hash, csrf, expires, clock, replaced_hash):
        with self.write() as db:
            db.execute(delete(login_attempts).where(login_attempts.c.address == address))
            db.execute(delete(sessions).where((sessions.c.expires <= clock) | (sessions.c.token_hash == replaced_hash)))
            db.execute(insert(sessions).values(token_hash=token_hash, user_id=user_id, csrf=csrf, expires=expires))

    def end_session(self, token_hash):
        with self.write() as db:
            db.execute(delete(sessions).where(sessions.c.token_hash == token_hash))

    # ------------------------------------------------------------ rule versions
    def latest_rule_version(self):
        with self.engine.connect() as db:
            return as_dict(db.execute(select(rule_versions).order_by(rule_versions.c.id.desc()).limit(1)).first())

    def rule_version(self, version):
        with self.engine.connect() as db:
            return as_dict(db.execute(select(rule_versions).where(rule_versions.c.id == version)).first())

    def rule_versions(self, limit=100):
        with self.engine.connect() as db:
            return [as_dict(r) for r in db.execute(select(rule_versions).order_by(rule_versions.c.id.desc()).limit(limit))]

    def add_rule_version(self, expected_version, created_by, reason, rules, created_at):
        try:
            with self.write() as db:
                current = db.execute(select(func.max(rule_versions.c.id))).scalar()
                if current != expected_version:
                    raise Conflict()
                row = {"id": current + 1, "created_at": created_at, "created_by": created_by, "reason": reason, "rules_json": json.dumps(rules)}
                db.execute(insert(rule_versions).values(**row))
                return row
        except IntegrityError as exc:  # another save took this version number first
            raise Conflict() from exc

    # ------------------------------------------------------------ uploads and import log
    def log_import(self, attempt, db=None):
        if db is not None:
            return db.execute(insert(import_attempts).values(**attempt))
        with self.write() as own:
            own.execute(insert(import_attempts).values(**attempt))

    def accept_upload(self, upload, attempt):
        """Store an accepted upload against the active rule version, logging the attempt in the same transaction."""
        with self.write() as db:
            policy = as_dict(db.execute(select(rule_versions).order_by(rule_versions.c.id.desc()).limit(1)).first())
            db.execute(insert(uploads).values(**upload, rule_version=policy["id"]))
            self.log_import({**attempt, "upload_id": upload["id"]}, db)
            return policy

    def upload(self, upload_id):
        with self.engine.connect() as db:
            return as_dict(db.execute(select(uploads).where(uploads.c.id == upload_id)).first())

    def import_query(self):
        return (select(import_attempts, users.c.name.label("owner"), runs.c.id.label("run_id"))
                .join(users, users.c.id == import_attempts.c.owner_id)
                .outerjoin(runs, runs.c.upload_id == import_attempts.c.upload_id))

    def imports(self, owner_id=None, status=None, offset=0, limit=25):
        filters = []
        if owner_id:
            filters.append(import_attempts.c.owner_id == owner_id)
        if status:
            filters.append(import_attempts.c.status == status)
        with self.engine.connect() as db:
            total = db.execute(select(func.count()).select_from(import_attempts).where(*filters)).scalar()
            rows = db.execute(self.import_query().where(*filters)
                              .order_by(import_attempts.c.created_at.desc(), import_attempts.c.id.desc()).offset(offset).limit(limit))
            return total, [as_dict(r) for r in rows]

    def import_attempt(self, import_id):
        with self.engine.connect() as db:
            return as_dict(db.execute(self.import_query().where(import_attempts.c.id == import_id)).first())

    # ------------------------------------------------------------ runs
    def run_query(self):
        return (select(runs, uploads.c.filename, uploads.c.file_hash, uploads.c.owner_id, users.c.name.label("owner"),
                       rule_versions.c.id.label("policy_id"), rule_versions.c.created_at.label("policy_created_at"),
                       rule_versions.c.created_by.label("policy_created_by"), rule_versions.c.reason.label("policy_reason"),
                       rule_versions.c.rules_json.label("policy_rules_json"), import_attempts.c.id.label("import_id"))
                .join(uploads, uploads.c.id == runs.c.upload_id)
                .join(users, users.c.id == uploads.c.owner_id)
                .join(rule_versions, rule_versions.c.id == uploads.c.rule_version)
                .outerjoin(import_attempts, import_attempts.c.upload_id == runs.c.upload_id))

    def run(self, run_id):
        with self.engine.connect() as db:
            return as_dict(db.execute(self.run_query().where(runs.c.id == run_id)).first())

    def run_for_upload(self, upload_id):
        with self.engine.connect() as db:
            return as_dict(db.execute(self.run_query().where(runs.c.upload_id == upload_id)).first())

    def add_run(self, run):
        """Save a run once per upload; a concurrent duplicate returns the run that won."""
        try:
            with self.write() as db:
                db.execute(insert(runs).values(**run))
        except IntegrityError:
            pass
        return self.run_for_upload(run["upload_id"])

    def runs(self, owner_id=None, filename=None, from_date=None, to_date=None, offset=0, limit=25):
        filters = []
        if owner_id:
            filters.append(uploads.c.owner_id == owner_id)
        if filename:
            filters.append(func.lower(uploads.c.filename).contains(filename.lower(), autoescape=True))
        if from_date:
            filters.append(runs.c.created_at >= from_date.isoformat())
        if to_date:  # inclusive UTC date: before the next day starts
            filters.append(runs.c.created_at < (to_date + timedelta(days=1)).isoformat())
        with self.engine.connect() as db:
            total = db.execute(select(func.count()).select_from(runs.join(uploads, uploads.c.id == runs.c.upload_id)).where(*filters)).scalar()
            rows = db.execute(self.run_query().where(*filters).order_by(runs.c.created_at.desc(), runs.c.id.desc()).offset(offset).limit(limit))
            return total, [as_dict(r) for r in rows]
