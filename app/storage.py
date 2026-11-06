import hashlib
import hmac
import json
import os
import secrets
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from .engine import DEFAULT_RULES


def now():
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def password_hash(password, salt=None):
    salt = salt or secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt), 600_000).hex()
    return salt + ":" + digest


def verify_password(password, stored):
    return hmac.compare_digest(password_hash(password, stored.split(":")[0]), stored)


@contextmanager
def connection(path):
    db = sqlite3.connect(path, timeout=15)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA foreign_keys=ON")
    try:
        with db:
            yield db
    finally:
        db.close()


def initialize(path):
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    with connection(path) as db:
        db.execute("PRAGMA journal_mode=WAL")
        db.executescript('''
        CREATE TABLE IF NOT EXISTS users (
          id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT UNIQUE NOT NULL,
          role TEXT NOT NULL CHECK(role IN ('scheduler','manager')), password_hash TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS sessions (
          token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id),
          csrf TEXT NOT NULL, expires REAL NOT NULL);
        CREATE TABLE IF NOT EXISTS login_attempts (
          address TEXT PRIMARY KEY, count INTEGER NOT NULL, window_start REAL NOT NULL);
        CREATE TABLE IF NOT EXISTS rule_versions (
          id INTEGER PRIMARY KEY AUTOINCREMENT, created_at TEXT NOT NULL,
          created_by TEXT REFERENCES users(id), reason TEXT NOT NULL, rules_json TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS uploads (
          id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES users(id), filename TEXT NOT NULL,
          file_hash TEXT NOT NULL, created_at TEXT NOT NULL, rule_version INTEGER NOT NULL REFERENCES rule_versions(id),
          rows_json TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS runs (
          id TEXT PRIMARY KEY, upload_id TEXT UNIQUE NOT NULL REFERENCES uploads(id),
          created_at TEXT NOT NULL, result_json TEXT NOT NULL);
        CREATE INDEX IF NOT EXISTS upload_owner ON uploads(owner_id);
        CREATE INDEX IF NOT EXISTS run_time ON runs(created_at);
        PRAGMA user_version=1;
        ''')
        for user_id, name, role, password in [
            ("scheduler", "Alex Morgan", "scheduler", os.getenv("CREWCHECK_SCHEDULER_PASSWORD", "SchedulerDemo!2026")),
            ("manager", "Taylor Reed", "manager", os.getenv("CREWCHECK_MANAGER_PASSWORD", "ManagerDemo!2026")),
        ]:
            if not db.execute("SELECT 1 FROM users WHERE id=?", (user_id,)).fetchone():
                db.execute("INSERT INTO users VALUES (?,?,?,?,?)", (user_id, name, role+"@crewcheck.local", role, password_hash(password)))
        if not db.execute("SELECT 1 FROM rule_versions LIMIT 1").fetchone():
            db.execute("INSERT INTO rule_versions(created_at,created_by,reason,rules_json) VALUES (?,?,?,?)",
                       (now(), "manager", "Initial illustrative rules. Not an FAA/EASA compliance profile.", json.dumps(DEFAULT_RULES)))
