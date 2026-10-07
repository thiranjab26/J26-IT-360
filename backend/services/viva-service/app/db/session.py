"""SQLAlchemy engine and session factory for viva-service.

Application traffic uses the Neon POOLED endpoint. SQLite (tests) has no schemas, so the
viva schema is translated away there.
"""

from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker

from app.config import settings


def build_engine(url):
    if url.startswith("postgres://"):
        url = url.replace("postgres://", "postgresql+psycopg://", 1)
    elif url.startswith("postgresql://"):
        url = url.replace("postgresql://", "postgresql+psycopg://", 1)
    # A remote database round trip costs ~0.4 s here: recycle connections before Neon drops idle ones instead of pinging on every checkout.
    engine = create_engine(
        url,
        connect_args={"check_same_thread": False} if url.startswith("sqlite") else {},
        pool_recycle=180,
    )
    if url.startswith("sqlite"):

        @event.listens_for(engine, "connect")
        def sqlite_pragmas(connection, _):
            connection.execute("PRAGMA foreign_keys=ON")
            connection.execute("PRAGMA busy_timeout=10000")

    if url.startswith("sqlite"):
        engine = engine.execution_options(schema_translate_map={settings().db_schema: None})
    return engine


engine = build_engine(settings().database_url)
SessionLocal = sessionmaker(engine, expire_on_commit=False)


def get_db():
    with SessionLocal() as db:
        yield db
