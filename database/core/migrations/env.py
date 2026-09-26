"""Alembic environment for the shared `core` schema.

The version table lives inside `core`, so this migration history can never
collide with a service's own history. Every service does the same thing with
its own schema name.
"""

from __future__ import annotations

import os
from logging.config import fileConfig
from pathlib import Path

from alembic import context
from sqlalchemy import engine_from_config, pool

config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

SCHEMA = "core"


def _database_url() -> str:
    """Read the connection string from the environment, loading .env if present."""
    here = Path(__file__).resolve()
    candidates = (
        here.parents[1] / ".env",  # database/core/.env
        here.parents[2] / ".env",  # database/.env
        here.parents[3] / ".env",  # repository root
    )
    for candidate in candidates:
        if candidate.exists():
            for line in candidate.read_text(encoding="utf-8").splitlines():
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                key, value = line.split("=", 1)
                os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))

    url = os.environ.get("CORE_DATABASE_URL") or os.environ.get("DATABASE_URL")
    if not url:
        raise RuntimeError(
            "Set DATABASE_URL (or CORE_DATABASE_URL) to your Neon branch connection "
            "string. Copy database/.env.example to database/.env."
        )
    # Accept a plain psql URL and normalise it to the psycopg 3 driver.
    if url.startswith("postgresql://"):
        url = url.replace("postgresql://", "postgresql+psycopg://", 1)
    return url


# No declarative metadata here: core migrations are written by hand so the
# shared reference schema only ever changes deliberately, by PR.
target_metadata = None


def run_migrations_offline() -> None:
    context.configure(
        url=_database_url(),
        target_metadata=target_metadata,
        literal_binds=True,
        include_schemas=True,
        version_table_schema=SCHEMA,
        dialect_opts={"paramstyle": "named"},
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    section = config.get_section(config.config_ini_section, {})
    section["sqlalchemy.url"] = _database_url()

    connectable = engine_from_config(section, prefix="sqlalchemy.", poolclass=pool.NullPool)

    with connectable.connect() as connection:
        connection.exec_driver_sql(f"CREATE SCHEMA IF NOT EXISTS {SCHEMA}")
        connection.commit()
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            include_schemas=True,
            version_table_schema=SCHEMA,
        )
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
