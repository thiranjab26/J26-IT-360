"""API v1 router. Mounted by the app factory under /api/v1/auth."""

from __future__ import annotations

from fastapi import APIRouter

from app.api.v1.routes import auth

api_router = APIRouter()
api_router.include_router(auth.router)
