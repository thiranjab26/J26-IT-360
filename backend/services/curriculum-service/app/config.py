"""Settings for curriculum-service. Every variable is listed in .env.example."""

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
    integration_mode: str = Field(default="stub", alias="INTEGRATION_MODE")

    # --- service ------------------------------------------------------------
    port: int = Field(default=8101, alias="CURRICULUM_PORT")
    db_schema: str = Field(default="curriculum", alias="CURRICULUM_DB_SCHEMA")

    @field_validator("database_url")
    @classmethod
    def normalise_driver(cls, value: str) -> str:
        if value.startswith("postgresql://"):
            return value.replace("postgresql://", "postgresql+psycopg://", 1)
        return value


@lru_cache
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]
