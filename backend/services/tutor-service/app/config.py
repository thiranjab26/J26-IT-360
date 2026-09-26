"""Settings for tutor-service (C3 VeriTutor).

Every variable this service reads is listed in .env.example. Service-specific
variables are prefixed TUTOR_; DATABASE_URL and INTEGRATION_MODE are shared.

Only the settings the current code actually reads live here. The generation,
retrieval and verification settings arrive with the phases that need them, so
nothing in .env.example is a variable with no reader.
"""

from __future__ import annotations

from functools import lru_cache

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
    db_schema: str = Field(default="tutor", alias="TUTOR_DB_SCHEMA")
    content_db_schema: str = Field(default="content", alias="TUTOR_CONTENT_DB_SCHEMA")

    @field_validator("database_url")
    @classmethod
    def normalise_driver(cls, value: str) -> str:
        if value.startswith("postgresql://"):
            return value.replace("postgresql://", "postgresql+psycopg://", 1)
        return value


@lru_cache
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]
