"""API v1 router. Mounted under /api/v1/curriculum."""

from __future__ import annotations

from fastapi import APIRouter

api_router = APIRouter()

# Arriving with later steps: graph, mastery, recommendations, assessments,
# gain, feedback and the lecturer cohort and graph-edit routes.
