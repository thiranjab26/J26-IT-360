"""All C4 routes, mounted by app.main under /api/v1/viva."""

from fastapi import APIRouter

from app.api.v1.routes import auth, bank, courses, evaluation, health, sessions, speech, topics

api_router = APIRouter()
for module in (health, auth, topics, sessions, speech, courses, bank, evaluation):
    api_router.include_router(module.router)
