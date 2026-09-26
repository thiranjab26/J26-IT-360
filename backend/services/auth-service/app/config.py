"""Settings for auth-service.

Every variable this service reads is listed in .env.example. Service-specific
variables are prefixed AUTH_; DATABASE_URL is shared across all services.
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

    # --- service ------------------------------------------------------------
    port: int = Field(default=8001, alias="AUTH_PORT")
    db_schema: str = Field(default="core", alias="AUTH_DB_SCHEMA")

    jwt_secret: str = Field(alias="AUTH_JWT_SECRET")
    jwt_algorithm: str = Field(default="HS256", alias="AUTH_JWT_ALGORITHM")
    jwt_issuer: str = Field(default="adaptlearn-auth", alias="AUTH_JWT_ISSUER")
    access_token_ttl_minutes: int = Field(default=720, alias="AUTH_ACCESS_TOKEN_TTL_MINUTES")

    @field_validator("database_url")
    @classmethod
    def normalise_driver(cls, value: str) -> str:
        """Accept a plain psql URL and route it through psycopg 3."""
        if value.startswith("postgresql://"):
            return value.replace("postgresql://", "postgresql+psycopg://", 1)
        return value


@lru_cache
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]
