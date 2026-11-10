"""Baseline schema.

Creates only what is missing, so databases created before Alembic was
introduced (CrewCheck <= 0.1 on SQLite) are adopted without data changes.

Revision ID: 0001
Revises:
"""
import sqlalchemy as sa
from alembic import op

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None


def table(name, *columns):
    if not sa.inspect(op.get_bind()).has_table(name):
        op.create_table(name, *columns)


def index(name, table_name, *columns, unique=False):
    existing = {i["name"] for i in sa.inspect(op.get_bind()).get_indexes(table_name)}
    if name not in existing:
        op.create_index(name, table_name, list(columns), unique=unique)


def upgrade():
    table("users",
          sa.Column("id", sa.String, primary_key=True),
          sa.Column("name", sa.String, nullable=False),
          sa.Column("email", sa.String, unique=True, nullable=False),
          sa.Column("role", sa.String, sa.CheckConstraint("role IN ('scheduler','manager')", name="users_role"), nullable=False),
          sa.Column("password_hash", sa.String, nullable=False))
    table("sessions",
          sa.Column("token_hash", sa.String, primary_key=True),
          sa.Column("user_id", sa.String, sa.ForeignKey("users.id"), nullable=False),
          sa.Column("csrf", sa.String, nullable=False),
          sa.Column("expires", sa.Float, nullable=False))
    table("login_attempts",
          sa.Column("address", sa.String, primary_key=True),
          sa.Column("count", sa.Integer, nullable=False),
          sa.Column("window_start", sa.Float, nullable=False))
    table("rule_versions",
          sa.Column("id", sa.Integer, primary_key=True, autoincrement=False),
          sa.Column("created_at", sa.String, nullable=False),
          sa.Column("created_by", sa.String, sa.ForeignKey("users.id")),
          sa.Column("reason", sa.Text, nullable=False),
          sa.Column("rules_json", sa.Text, nullable=False))
    table("uploads",
          sa.Column("id", sa.String, primary_key=True),
          sa.Column("owner_id", sa.String, sa.ForeignKey("users.id"), nullable=False),
          sa.Column("filename", sa.String, nullable=False),
          sa.Column("file_hash", sa.String, nullable=False),
          sa.Column("created_at", sa.String, nullable=False),
          sa.Column("rule_version", sa.Integer, sa.ForeignKey("rule_versions.id"), nullable=False),
          sa.Column("rows_json", sa.Text, nullable=False))
    table("runs",
          sa.Column("id", sa.String, primary_key=True),
          sa.Column("upload_id", sa.String, sa.ForeignKey("uploads.id"), unique=True, nullable=False),
          sa.Column("created_at", sa.String, nullable=False),
          sa.Column("result_json", sa.Text, nullable=False))
    table("import_attempts",
          sa.Column("id", sa.String, primary_key=True),
          sa.Column("owner_id", sa.String, sa.ForeignKey("users.id"), nullable=False),
          sa.Column("filename", sa.String, nullable=False),
          sa.Column("created_at", sa.String, nullable=False),
          sa.Column("size", sa.Integer, nullable=False),
          sa.Column("file_hash", sa.String),
          sa.Column("stored", sa.Integer, nullable=False),
          sa.Column("status", sa.String, sa.CheckConstraint("status IN ('accepted','rejected','needs_setup')", name="import_status"), nullable=False),
          sa.Column("upload_id", sa.String, sa.ForeignKey("uploads.id")),
          sa.Column("row_count", sa.Integer),
          sa.Column("options_json", sa.Text, nullable=False),
          sa.Column("errors_json", sa.Text, nullable=False),
          sa.Column("import_options_json", sa.Text))
    index("upload_owner", "uploads", "owner_id")
    index("run_time", "runs", "created_at")
    index("import_owner_time", "import_attempts", "owner_id", "created_at")
    index("import_upload", "import_attempts", "upload_id")


def downgrade():
    for name in ("import_attempts", "runs", "uploads", "rule_versions", "login_attempts", "sessions", "users"):
        op.drop_table(name)
