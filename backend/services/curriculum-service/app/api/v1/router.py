"""API v1 router. Mounted under /api/v1/curriculum."""

from __future__ import annotations

from fastapi import APIRouter

from app.api.v1.routes import catalogue

api_router = APIRouter()
api_router.include_router(catalogue.router)
