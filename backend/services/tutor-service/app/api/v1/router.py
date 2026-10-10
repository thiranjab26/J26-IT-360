"""API v1 router. Mounted under /api/v1/tutor."""

from __future__ import annotations

from fastapi import APIRouter

from app.api.v1.routes import catalogue, sessions

api_router = APIRouter()
api_router.include_router(catalogue.router)
api_router.include_router(sessions.router)

# Arriving with later phases: practicals, content admin and the internal
# /internal/load receiver.
