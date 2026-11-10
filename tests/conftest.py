"""Run the whole suite against another database by setting an admin URL, e.g.

    CREWCHECK_TEST_DATABASE_URL=postgresql+psycopg://postgres:crewcheck@localhost:55432/postgres uv run pytest

Each test then gets a fresh, empty database. Without the variable, tests use a
temporary SQLite file per test.
"""
import os
import uuid

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url

ADMIN_URL = os.getenv("CREWCHECK_TEST_DATABASE_URL")


@pytest.fixture(autouse=True)
def isolated_database(monkeypatch):
    if not ADMIN_URL:
        monkeypatch.delenv("CREWCHECK_DATABASE_URL", raising=False)
        yield
        return
    name = f"crewcheck_test_{uuid.uuid4().hex[:12]}"
    admin = create_engine(ADMIN_URL, isolation_level="AUTOCOMMIT")
    with admin.connect() as db:
        db.execute(text(f'CREATE DATABASE "{name}"'))
    monkeypatch.setenv("CREWCHECK_DATABASE_URL", make_url(ADMIN_URL).set(database=name).render_as_string(hide_password=False))
    try:
        yield
    finally:
        with admin.connect() as db:
            db.execute(text(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)'))
        admin.dispose()
