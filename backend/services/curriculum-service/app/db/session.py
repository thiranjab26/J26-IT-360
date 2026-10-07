"""SQLAlchemy engine for the Neon Postgres database.

Created lazily on first use, so importing the app (and running unit tests)
never opens a connection. Application traffic uses DATABASE_URL, which should
be Neon's POOLED endpoint.
"""

from __future__ import annotations

from functools import lru_cache

from sqlalchemy import create_engine
from sqlalchemy.engine import Engine

from app.config import get_settings


@lru_cache
def get_engine() -> Engine:
    return create_engine(
        get_settings().database_url,
        pool_pre_ping=True,
        pool_size=5,
        max_overflow=5,
    )
