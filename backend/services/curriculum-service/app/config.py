"""Settings for curriculum-service (C1 Adaptive Curriculum Engine).

Every variable this service reads is listed in .env.example. Service-specific
variables are prefixed CURRICULUM_; DATABASE_URL, ENVIRONMENT, LOG_LEVEL and
INTEGRATION_MODE are shared.

Only the settings the current code actually reads live here. Neo4j, the
mastery threshold and the model file arrive with the steps that need them.
"""

from __future__ import annotations

from functools import lru_cache
from typing import Literal

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
    environment: Literal["development", "test", "production"] = Field(
        default="development", alias="ENVIRONMENT"
    )
    log_level: str = Field(default="info", alias="LOG_LEVEL")
    # stub | live. Cross-component reads stay stubbed until the producing
    # component publishes its view.
    integration_mode: Literal["stub", "live"] = Field(default="stub", alias="INTEGRATION_MODE")

    # --- service ------------------------------------------------------------
    port: int = Field(default=8101, alias="CURRICULUM_PORT")

    @field_validator("database_url")
    @classmethod
    def normalise_driver(cls, value: str) -> str:
        if value.startswith("postgresql://"):
            return value.replace("postgresql://", "postgresql+psycopg://", 1)
        return value

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
