"""Settings for tutor-service (C3 VeriTutor).

Every variable this service reads is listed in .env.example. Service-specific
variables are prefixed TUTOR_; DATABASE_URL and INTEGRATION_MODE are shared.

Only the settings the current code actually reads live here. The generation,
retrieval and verification settings arrive with the phases that need them, so
nothing in .env.example is a variable with no reader.
"""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # --- shared -------------------------------------------------------------
    database_url: str = Field(alias="DATABASE_URL")
    environment: str = Field(default="development", alias="ENVIRONMENT")
    log_level: str = Field(default="info", alias="LOG_LEVEL")
    # stub | live. Cross-component reads (C1 mastery, C2 load) stay stubbed
    # until phase P7.
    integration_mode: str = Field(default="stub", alias="INTEGRATION_MODE")

    # --- service ------------------------------------------------------------
    port: int = Field(default=8301, alias="TUTOR_PORT")

    # Alembic and the content sync use this when set. Neon's pooled endpoint is
    # right for request traffic; schema changes belong on the direct endpoint.
    migration_database_url: str | None = Field(default=None, alias="TUTOR_MIGRATION_DATABASE_URL")

    # Authored course material. A relative path is resolved against this service's
    # folder, so the CLI works from any working directory.
    content_dir: Path = Field(default=Path("content"), alias="TUTOR_CONTENT_DIR")

    @field_validator("database_url", "migration_database_url")
    @classmethod
    def normalise_driver(cls, value: str | None) -> str | None:
        """Accept a plain psql URL and route it through psycopg 3."""
        if value and value.startswith("postgresql://"):
            return value.replace("postgresql://", "postgresql+psycopg://", 1)
        return value

    @property
    def content_root(self) -> Path:
        if self.content_dir.is_absolute():
            return self.content_dir
        return Path(__file__).resolve().parents[1] / self.content_dir


@lru_cache
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]
