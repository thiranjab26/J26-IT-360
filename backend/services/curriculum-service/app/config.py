"""Settings for curriculum-service (C1 Adaptive Curriculum Engine).

Every variable this service reads is listed in .env.example. Service-specific
variables are prefixed CURRICULUM_; DATABASE_URL, ENVIRONMENT, LOG_LEVEL and
INTEGRATION_MODE are shared.

Only the settings the current code actually reads live here. The mastery
threshold and the model file arrive with the steps that need them.
"""

from __future__ import annotations

from functools import lru_cache
from typing import Literal

from pydantic import Field, SecretStr, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


def _normalise_driver(value: str | None) -> str | None:
    if value and value.startswith("postgresql://"):
        return value.replace("postgresql://", "postgresql+psycopg://", 1)
    return value


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # --- shared -------------------------------------------------------------
    database_url: str = Field(alias="DATABASE_URL")
    environment: Literal["development", "test", "production"] = Field(
        default="development", alias="ENVIRONMENT"
    )
    log_level: str = Field(default="info", alias="LOG_LEVEL")
    # stub | live. Cross-component reads stay stubbed until the producing
    # component publishes its view.
    integration_mode: Literal["stub", "live"] = Field(default="stub", alias="INTEGRATION_MODE")

    # --- service ------------------------------------------------------------
    port: int = Field(default=8101, alias="CURRICULUM_PORT")
    # Migrations change table structure, so they use Neon's DIRECT (unpooled)
    # endpoint. Falls back to DATABASE_URL when unset.
    migration_database_url: str | None = Field(
        default=None, alias="CURRICULUM_MIGRATION_DATABASE_URL"
    )

    # Neo4j holds the prerequisite graph. Optional: when any of these is unset
    # the service reads the graph from Postgres, so teammates never need Neo4j.
    neo4j_uri: str | None = Field(default=None, alias="CURRICULUM_NEO4J_URI")
    neo4j_user: str | None = Field(default=None, alias="CURRICULUM_NEO4J_USER")
    neo4j_password: SecretStr | None = Field(default=None, alias="CURRICULUM_NEO4J_PASSWORD")

    @field_validator("database_url", "migration_database_url")
    @classmethod
    def normalise_driver(cls, value: str | None) -> str | None:
        return _normalise_driver(value)

    @property
    def neo4j_enabled(self) -> bool:
        return bool(self.neo4j_uri and self.neo4j_user and self.neo4j_password)

    @property
    def migrations_url(self) -> str:
        return self.migration_database_url or self.database_url

    @property
    def is_production(self) -> bool:
        return self.environment == "production"

    @property
    def dev_tools_enabled(self) -> bool:
        """Development-only endpoints exist only outside production and in stub mode."""
        return self.environment != "production" and self.integration_mode == "stub"


@lru_cache
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]
