"""FastAPI application factory for tutor-service (C3 VeriTutor).

Current phase: P0 Foundation. The learner catalogue is live; generation,
retrieval and the faithfulness gate arrive in P1 to P3.
"""

from __future__ import annotations

import logging

from fastapi import FastAPI

from app.api.v1.router import api_router
from app.api.v1.routes import health
from app.config import get_settings
from app.core.errors import install_error_handlers
from app.core.logging import RequestContextMiddleware, configure_logging

SERVICE_NAME = "tutor-service"
API_PREFIX = "/api/v1/tutor"


def create_app() -> FastAPI:
    settings = get_settings()
    configure_logging(settings.log_level)

    app = FastAPI(
        title=SERVICE_NAME,
        version="0.1.0",
        description="C3 VeriTutor. Faithfulness-verified, mastery-gated AI tutor.",
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
        extra={
            "environment": settings.environment,
            "port": settings.port,
            "integration_mode": settings.integration_mode,
        },
    )
    return app


app = create_app()
