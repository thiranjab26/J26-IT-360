"""FastAPI application factory for auth-service.

Routes:
    GET  /health                        liveness, outside the versioned prefix
    POST /api/v1/auth/register/student
    POST /api/v1/auth/register/lecturer
    POST /api/v1/auth/login
    GET  /api/v1/auth/me
"""

from __future__ import annotations

import logging

from fastapi import FastAPI

from app.api.v1.router import api_router
from app.api.v1.routes import health
from app.config import get_settings
from app.core.errors import install_error_handlers
from app.core.logging import RequestContextMiddleware, configure_logging

SERVICE_NAME = "auth-service"
API_PREFIX = "/api/v1/auth"


def create_app() -> FastAPI:
    settings = get_settings()
    configure_logging(settings.log_level)

    app = FastAPI(
        title=SERVICE_NAME,
        version="0.1.0",
        description="AdaptLearn authentication. Owns core.users and issues access tokens.",
        docs_url="/docs",
        openapi_url="/openapi.json",
    )

    app.add_middleware(RequestContextMiddleware)
    install_error_handlers(app)

    # Health is served at both paths on purpose: /health for a direct probe of
    # this process, and <prefix>/health so it is reachable through the gateway,
    # which forwards the full path unchanged.
    app.include_router(health.router)
    app.include_router(health.router, prefix=API_PREFIX)
    app.include_router(api_router, prefix=API_PREFIX)

    logging.getLogger(SERVICE_NAME).info(
        "service configured",
        extra={"environment": settings.environment, "port": settings.port},
    )
    return app


app = create_app()
