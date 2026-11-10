"""Database tables, written with SQLAlchemy Core so the same code runs on SQLite
and PostgreSQL. Schema changes go through Alembic migrations in app/migrations.

Timestamps are ISO-8601 UTC text and structured snapshots are JSON text, which
keeps saved evidence byte-identical across databases.
"""
from sqlalchemy import CheckConstraint, Column, Float, ForeignKey, Index, Integer, MetaData, String, Table, Text

metadata = MetaData()

users = Table(
    "users", metadata,
    Column("id", String, primary_key=True),
    Column("name", String, nullable=False),
    Column("email", String, unique=True, nullable=False),
    Column("role", String, CheckConstraint("role IN ('scheduler','manager')", name="users_role"), nullable=False),
    Column("password_hash", String, nullable=False),
)

sessions = Table(
    "sessions", metadata,
    Column("token_hash", String, primary_key=True),
    Column("user_id", String, ForeignKey("users.id"), nullable=False),
    Column("csrf", String, nullable=False),
    Column("expires", Float, nullable=False),
)

login_attempts = Table(
    "login_attempts", metadata,
    Column("address", String, primary_key=True),
    Column("count", Integer, nullable=False),
    Column("window_start", Float, nullable=False),
)

# Version numbers are assigned explicitly (previous + 1); the primary key then
# rejects a second concurrent save of the same version on any database.
rule_versions = Table(
    "rule_versions", metadata,
    Column("id", Integer, primary_key=True, autoincrement=False),
    Column("created_at", String, nullable=False),
    Column("created_by", String, ForeignKey("users.id")),
    Column("reason", Text, nullable=False),
    Column("rules_json", Text, nullable=False),
)

uploads = Table(
    "uploads", metadata,
    Column("id", String, primary_key=True),
    Column("owner_id", String, ForeignKey("users.id"), nullable=False),
    Column("filename", String, nullable=False),
    Column("file_hash", String, nullable=False),
    Column("created_at", String, nullable=False),
    Column("rule_version", Integer, ForeignKey("rule_versions.id"), nullable=False),
    Column("rows_json", Text, nullable=False),
    Index("upload_owner", "owner_id"),
)

runs = Table(
    "runs", metadata,
    Column("id", String, primary_key=True),
    Column("upload_id", String, ForeignKey("uploads.id"), unique=True, nullable=False),
    Column("created_at", String, nullable=False),
    Column("result_json", Text, nullable=False),
    Index("run_time", "created_at"),
)

import_attempts = Table(
    "import_attempts", metadata,
    Column("id", String, primary_key=True),
    Column("owner_id", String, ForeignKey("users.id"), nullable=False),
    Column("filename", String, nullable=False),
    Column("created_at", String, nullable=False),
    Column("size", Integer, nullable=False),
    Column("file_hash", String),
    Column("stored", Integer, nullable=False),
    Column("status", String, CheckConstraint("status IN ('accepted','rejected','needs_setup')", name="import_status"), nullable=False),
    Column("upload_id", String, ForeignKey("uploads.id")),
    Column("row_count", Integer),
    Column("options_json", Text, nullable=False),
    Column("errors_json", Text, nullable=False),
    Column("import_options_json", Text),
    Index("import_owner_time", "owner_id", "created_at"),
    Index("import_upload", "upload_id"),
)
