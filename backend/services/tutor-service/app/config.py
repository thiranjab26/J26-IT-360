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

from pydantic import Field, SecretStr, field_validator
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

    # Embedded vector store (ChromaDB). Private to this service and gitignored.
    chroma_path: Path = Field(default=Path(".chroma"), alias="TUTOR_CHROMA_PATH")

    # Local sentence embedding model. MiniLM reads 256 tokens, so the ends of the longer
    # chunks are not embedded; measured on the Programming module that cost nothing, and
    # MiniLM with hybrid retrieval was the most robust option. Evidence and limits are in
    # research/c3-RAG tutor/README.md.
    embedding_model: str = Field(
        default="sentence-transformers/all-MiniLM-L6-v2", alias="TUTOR_EMBEDDING_MODEL"
    )

    # --- guided sessions ----------------------------------------------------
    # mastery_gated | points_only. The two study conditions: what unlocks the next concept.
    session_policy: str = Field(default="mastery_gated", alias="TUTOR_SESSION_POLICY")
    # False opens every concept, for demos and for testing a late concept without
    # working through the earlier ones.
    enforce_unlocks: bool = Field(default=True, alias="TUTOR_ENFORCE_UNLOCKS")

    # --- LLM providers ------------------------------------------------------
    # Read by the generation layer (phase P2). Gemini is the cloud provider; Ollama is
    # the local fallback for when there is no connectivity.
    llm_provider: str = Field(default="gemini", alias="TUTOR_LLM_PROVIDER")

    # Left empty until you add your key. SecretStr keeps it out of logs and repr().
    gemini_api_key: SecretStr | None = Field(default=None, alias="TUTOR_GEMINI_API_KEY")
    # Check the current model names in Google AI Studio and change this if it has moved on.
    gemini_model: str = Field(default="gemini-2.5-flash", alias="TUTOR_GEMINI_MODEL")

    ollama_base_url: str = Field(default="http://localhost:11434", alias="TUTOR_OLLAMA_BASE_URL")
    ollama_model: str = Field(default="qwen2.5-coder:7b", alias="TUTOR_OLLAMA_MODEL")

    @field_validator("database_url", "migration_database_url")
    @classmethod
    def normalise_driver(cls, value: str | None) -> str | None:
        """Accept a plain psql URL and route it through psycopg 3."""
        if value and value.startswith("postgresql://"):
            return value.replace("postgresql://", "postgresql+psycopg://", 1)
        return value

    @property
    def gemini_configured(self) -> bool:
        """True once a real key has been supplied (an empty value counts as missing)."""
        return bool(self.gemini_api_key and self.gemini_api_key.get_secret_value().strip())

    @property
    def content_root(self) -> Path:
        return _service_path(self.content_dir)

    @property
    def chroma_root(self) -> Path:
        return _service_path(self.chroma_path)


def _service_path(path: Path) -> Path:
    """A relative path is resolved against the tutor-service folder, not the cwd."""
    return path if path.is_absolute() else Path(__file__).resolve().parents[1] / path


@lru_cache
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]
