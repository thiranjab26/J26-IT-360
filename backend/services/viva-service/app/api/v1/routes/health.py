"""C4 health routes, mounted under /api/v1/viva."""

from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.config import settings
from app.db.session import engine, get_db
from app.integrations.context import adapter

router = APIRouter()


@router.get("/health")
def health(db: Session = Depends(get_db)):
    db.execute(text("SELECT 1"))
    cfg = settings()
    return {
        "status": "ok",
        "database": "sqlite" if engine.dialect.name == "sqlite" else "postgresql",
        "assessment_provider": cfg.assessment_provider,
        "speech_provider": cfg.speech_provider,
        "live_speech_provider": "deepgram:" + cfg.deepgram_stt_model
        if cfg.allow_cloud_llm and cfg.deepgram_api_key and cfg.deepgram_daily_seconds
        else None,
        "voice_provider": "deepgram:" + cfg.deepgram_tts_model
        if cfg.allow_cloud_llm and cfg.deepgram_api_key and cfg.deepgram_tts_daily_chars
        else ("groq:" + cfg.tts_model if cfg.allow_cloud_llm and cfg.speech_api_key else "browser"),
        "integration_mode": adapter.mode,
        "demo_mode": cfg.assessment_provider == "demo",
    }
