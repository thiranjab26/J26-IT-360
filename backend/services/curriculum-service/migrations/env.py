"""Alembic environment for curriculum-service.

Migrates the `curriculum` schema only, with its own version table inside that
schema (`curriculum.alembic_version`), so it can never collide with the `core`
history in database/core or with another service's migrations.
"""

from __future__ import annotations

from logging.config import fileConfig

from alembic import context
from sqlalchemy import create_engine, pool, text

from app.config import get_settings

SCHEMA = "curriculum"

config = context.config
# Without this, alembic runs silently: the [loggers] section of alembic.ini
# is what prints "Running upgrade ..." lines.
if config.config_file_name is not None:
    fileConfig(config.config_file_name)


def run_migrations_offline() -> None:
    """`alembic upgrade head --sql`: print the SQL without connecting."""
    context.configure(
        url=get_settings().migrations_url,
        literal_binds=True,
        version_table_schema=SCHEMA,
    )
    with context.begin_transaction():
        context.execute(f"CREATE SCHEMA IF NOT EXISTS {SCHEMA}")
        context.run_migrations()


def run_migrations_online() -> None:
    engine = create_engine(get_settings().migrations_url, poolclass=pool.NullPool)
    with engine.connect() as connection:
        # The version table lives inside the schema, so the schema must exist first.
        connection.execute(text(f"CREATE SCHEMA IF NOT EXISTS {SCHEMA}"))
        connection.commit()
        context.configure(connection=connection, version_table_schema=SCHEMA)
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
