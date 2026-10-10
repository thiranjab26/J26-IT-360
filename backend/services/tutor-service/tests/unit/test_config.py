"""Settings: defaults, and the one rule that matters for the API key."""

from __future__ import annotations

import pytest

from app.config import Settings

DB = "postgresql://user:pw@localhost/db"


def settings(**env: str) -> Settings:
    # _env_file=None so the developer's real .env cannot change what a test sees.
    return Settings(DATABASE_URL=DB, _env_file=None, **env)


def test_the_llm_defaults_match_what_is_installed_and_documented() -> None:
    s = settings()

    assert s.llm_provider == "gemini"
    assert s.ollama_base_url == "http://localhost:11434"
    assert s.ollama_model == "qwen2.5-coder:7b"
    assert s.gemini_model


def test_gemini_is_not_configured_until_a_key_is_supplied() -> None:
    assert not settings().gemini_configured
    assert not settings(TUTOR_GEMINI_API_KEY="").gemini_configured
    assert not settings(TUTOR_GEMINI_API_KEY="   ").gemini_configured
    assert settings(TUTOR_GEMINI_API_KEY="abc123").gemini_configured


def test_the_api_key_never_appears_when_settings_are_printed_or_logged() -> None:
    s = settings(TUTOR_GEMINI_API_KEY="super-secret-key-value")

    for rendering in (repr(s), str(s), s.model_dump_json(), repr(s.gemini_api_key)):
        assert "super-secret-key-value" not in rendering


def test_the_key_can_still_be_read_deliberately() -> None:
    s = settings(TUTOR_GEMINI_API_KEY="super-secret-key-value")

    assert s.gemini_api_key.get_secret_value() == "super-secret-key-value"


@pytest.mark.parametrize("name", ["embedding_model", "content_dir", "chroma_path"])
def test_the_service_paths_and_model_have_defaults(name: str) -> None:
    assert getattr(settings(), name)


def test_the_default_embedding_model_is_the_measured_choice() -> None:
    assert settings().embedding_model == "sentence-transformers/all-MiniLM-L6-v2"
