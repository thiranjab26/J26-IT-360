"""FastAPI application factory for curriculum-service (C1).

P0 scaffold: a read-only catalogue over the shared `core` reference data so the
student dashboard has real modules and concepts to render. The adaptive engine
(concept graph, BKT mastery, next-topic decisions) is C1's work and lands in
this service's own `curriculum` schema.
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

    app = FastAPI(
        title=SERVICE_NAME,
        version="0.1.0",
        description="C1 Adaptive Curriculum Engine. P0: read-only module and concept catalogue.",
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
