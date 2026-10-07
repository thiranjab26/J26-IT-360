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
        "integration_mode": adapter.mode,
        "demo_mode": cfg.assessment_provider == "demo",
    }
