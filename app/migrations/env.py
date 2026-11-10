"""Alembic environment. The app passes an open connection (see Repository.migrate);
the CLI falls back to CREWCHECK_DATABASE_URL."""
import os

from alembic import context
from sqlalchemy import create_engine

from app.schema import metadata

config = context.config


def run(connection):
    context.configure(connection=connection, target_metadata=metadata,
                      render_as_batch=connection.dialect.name == "sqlite")  # SQLite needs batch mode for ALTER
    with context.begin_transaction():
        context.run_migrations()


connection = config.attributes.get("connection")
if connection is not None:
    run(connection)
else:
    with create_engine(os.environ["CREWCHECK_DATABASE_URL"]).begin() as own:
        run(own)
