"""Settings for viva-service (C4). Every variable is listed in .env.example."""

from functools import lru_cache
from typing import Literal

from pydantic import AliasChoices, Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    # Service variables are prefixed VIVA_; DATABASE_URL, ENVIRONMENT, LOG_LEVEL and
    # INTEGRATION_MODE are shared names across AdaptLearn services.
    model_config = SettingsConfigDict(env_file=".env", env_prefix="VIVA_", extra="ignore")
    database_url: str = Field(
        default="sqlite:///./viva.db", validation_alias=AliasChoices("DATABASE_URL")
    )
    environment: str = Field(default="development", validation_alias=AliasChoices("ENVIRONMENT"))
    log_level: str = Field(default="info", validation_alias=AliasChoices("LOG_LEVEL"))
    integration_mode: str = Field(default="stub", validation_alias=AliasChoices("INTEGRATION_MODE"))
    port: int = 8401
    db_schema: str = "viva"
    create_tables_on_startup: bool = False
    dev_mode: bool = True
    admin_access_keys: str = "demo-admin-local"
    evaluator_access_keys: str = "demo-evaluator-local,demo-evaluator-two-local"
    token_hours: int = 24
    assessment_provider: str = "demo"
    generation_provider: str = "demo"
    llm_base_url: str = "http://127.0.0.1:11434"
    llm_model: str = "qwen2.5:7b"
    llm_api_key: str = ""
    allow_cloud_llm: bool = False
    demo_fallback: bool = False
    # disabled | faster_whisper (local) | groq (cloud Whisper, local faster-whisper as fallback when installed)
    speech_provider: str = "disabled"
    speech_base_url: str = "https://api.groq.com/openai/v1"
    speech_api_key: str = ""
    speech_model: str = "whisper-large-v3-turbo"
    # Cloud text-to-speech on the same provider; the browser's female voice is the fallback.
    tts_model: str = "canopylabs/orpheus-v1-english"
    # Groq Orpheus voices: autumn, diana, hannah, austin, daniel, troy.
    tts_voice: str = "diana"
    # Deepgram: live transcription (Nova-3, keeps fillers) and the examiner voice (Aura-2).
    # Empty key turns both off; Groq or the browser voice is used instead.
    deepgram_api_key: str = ""
    deepgram_stt_model: str = "nova-3"
    deepgram_tts_model: str = "aura-2-thalia-en"
    # Strict UTC-day budgets: streamed audio seconds and spoken characters. 0 disables that feature.
    deepgram_daily_seconds: int = Field(default=3600, ge=0)
    deepgram_user_daily_seconds: int = Field(default=900, ge=0)
    deepgram_tts_daily_chars: int = Field(default=20000, ge=0)
    deepgram_max_streams: int = Field(default=2, ge=1, le=20)
    whisper_model: str = "base.en"
    whisper_device: str = "cpu"
    max_audio_bytes: int = 20 * 1024 * 1024
    allowed_origins: str = "http://localhost:5173,http://127.0.0.1:5173"
    seed_demo_bank: bool = True
    c01_api_url: str = ""
    c02_api_url: str = ""
    c03_api_url: str = ""
    integration_api_token: str = ""
    integration_timeout_seconds: float = 10
    c01_review_url: str = ""
    llm_timeout_seconds: float = Field(default=45, ge=1, le=120)
    llm_max_output_tokens: int = Field(default=4096, ge=256, le=16000)
    llm_output_mode: Literal["json_schema", "prompt_json"] = "json_schema"
    # Comma-separated model IDs, using the same URL and key. Verify each first.
    llm_fallback_models: str = ""
    # Second OpenAI-compatible provider (e.g. Groq), tried when the primary is rate limited or unavailable.
    fallback_llm_base_url: str = ""
    fallback_llm_model: str = ""
    fallback_llm_api_key: str = ""
    fallback_llm_output_mode: Literal["json_schema", "prompt_json"] = "json_schema"
    # LLM phrases deterministic follow-ups and personalises the improvement plan; off keeps stored wording.
    llm_follow_up_phrasing: bool = True
    llm_max_attempts: int = Field(default=3, ge=1, le=6)
    llm_operation_timeout_seconds: float = Field(default=90, ge=5, le=100)
    api_requests_per_minute: int = Field(default=120, ge=1)
    auth_requests_per_minute: int = Field(default=10, ge=1)
    llm_requests_per_minute: int = Field(default=15, ge=1)
    llm_daily_calls: int = Field(default=500, ge=1)
    llm_user_daily_calls: int = Field(default=50, ge=1)
    llm_daily_token_budget: int = Field(default=2000000, ge=1)
    speech_user_daily_calls: int = Field(default=100, ge=1)
    speech_daily_calls: int = Field(default=1000, ge=1)
    whisper_compute_type: str = "int8"
    whisper_cpu_threads: int = Field(default=4, ge=1, le=64)
    whisper_beam_size: int = Field(default=1, ge=1, le=5)
    whisper_language: str = "en"
    speech_warmup: bool = False
    max_material_bytes: int = Field(default=5 * 1024 * 1024, ge=1024, le=20 * 1024 * 1024)
    max_material_chars: int = Field(default=200000, ge=1000, le=1000000)

    def validate_deployment(self):
        if not self.dev_mode:
            for value in (self.admin_access_keys, self.evaluator_access_keys):
                if not value or any(
                    len(k.strip()) < 24 or "demo" in k.lower() for k in value.split(",")
                ):
                    raise RuntimeError(
                        "Non-development mode (VIVA_DEV_MODE=false) requires separate strong admin/evaluator access keys (24+ characters)."
                    )
        if set(self.admin_access_keys.split(",")) & set(self.evaluator_access_keys.split(",")):
            raise RuntimeError("Admin and evaluator access keys must be distinct.")
        for provider in (self.assessment_provider, self.generation_provider):
            if provider not in ("demo", "ollama", "openai"):
                raise RuntimeError(
                    "Provider must be demo, ollama, or openai (including Gemini-compatible endpoints)."
                )


@lru_cache
def settings():
    return Settings()
