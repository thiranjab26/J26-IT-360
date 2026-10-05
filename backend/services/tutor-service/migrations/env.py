"""Alembic environment for tutor-service.

Migrates this service's two schemas, `content` and `tutor`, and nothing else. The
version table sits in `tutor`, so this history can never collide with another
service's. `target_metadata` is the real table metadata, which is what makes
`alembic check` able to tell you when app/db/tables.py and the migrations drift.
"""

from __future__ import annotations

from logging.config import fileConfig

from alembic import context
from sqlalchemy import engine_from_config, pool

from app.config import get_settings
from app.db.tables import CONTENT_SCHEMA, TUTOR_SCHEMA, metadata

config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

OWN_SCHEMAS = {CONTENT_SCHEMA, TUTOR_SCHEMA}


def _database_url() -> str:
    settings = get_settings()
    return settings.migration_database_url or settings.database_url


def _include_name(name: str | None, type_: str, parent_names: dict) -> bool:
    """Look only at our own schemas, so autogenerate never touches `core` or another
    owner's tables on the shared database."""
    if type_ == "schema":
        return name in OWN_SCHEMAS
    return True


def run_migrations_offline() -> None:
    context.configure(
        url=_database_url(),
        target_metadata=metadata,
        literal_binds=True,
        include_schemas=True,
        include_name=_include_name,
        version_table_schema=TUTOR_SCHEMA,
        dialect_opts={"paramstyle": "named"},
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    section = config.get_section(config.config_ini_section, {})
    section["sqlalchemy.url"] = _database_url()

    connectable = engine_from_config(section, prefix="sqlalchemy.", poolclass=pool.NullPool)

    with connectable.connect() as connection:
        # The version table needs its schema to exist before the first migration runs.
        for schema in sorted(OWN_SCHEMAS):
            connection.exec_driver_sql(f"CREATE SCHEMA IF NOT EXISTS {schema}")
        connection.commit()

        context.configure(
            connection=connection,
            target_metadata=metadata,
            include_schemas=True,
            include_name=_include_name,
            version_table_schema=TUTOR_SCHEMA,
        )
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
