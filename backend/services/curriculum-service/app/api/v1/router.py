"""API v1 router. Mounted under /api/v1/curriculum."""

from __future__ import annotations

from fastapi import APIRouter

from app.api.v1.routes import graph, mastery

api_router = APIRouter()
api_router.include_router(graph.router)
api_router.include_router(mastery.router)

# Development-only routes (app.api.v1.routes.dev) are mounted by main.create_app.
