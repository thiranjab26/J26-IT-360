"""FastAPI application factory for curriculum-service (C1 Adaptive Curriculum Engine).

The engine keeps a prerequisite graph of concepts, a Bayesian Knowledge Tracing
mastery estimate per learner and concept, and ranks what each learner is ready
to study next with an explanation naming the weak prerequisite behind it.
"""

from __future__ import annotations

import logging

from fastapi import FastAPI

from app.api.v1.router import api_router
from app.api.v1.routes import health
from app.config import get_settings
from app.core.errors import install_error_handlers
from app.core.logging import RequestContextMiddleware, configure_logging

SERVICE_NAME = "curriculum-service"
API_PREFIX = "/api/v1/curriculum"


def create_app() -> FastAPI:
    settings = get_settings()
    configure_logging(settings.log_level)

    # The interactive docs and schema are for development and type generation
    # (pnpm gen:types:curriculum). Production does not advertise its surface.
    app = FastAPI(
        title=SERVICE_NAME,
        version="0.1.0",
        description="C1 Adaptive Curriculum Engine. Explainable prerequisite-aware sequencing.",
        docs_url=None if settings.is_production else "/docs",
        redoc_url=None,
        openapi_url=None if settings.is_production else "/openapi.json",
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
