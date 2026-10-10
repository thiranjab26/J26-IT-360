"""API v1 router. Mounted under /api/v1/curriculum."""

from __future__ import annotations

from fastapi import APIRouter

from app.api.v1.routes import assessment, graph, graph_edit, mastery, study

api_router = APIRouter()
api_router.include_router(graph.router)
api_router.include_router(graph_edit.router)
api_router.include_router(mastery.router)
api_router.include_router(assessment.router)
api_router.include_router(study.router)

# Development-only routes (dev) and the C3 stand-in (practice) are mounted by main.create_app.
