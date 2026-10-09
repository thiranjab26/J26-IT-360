"""FastAPI application factory for curriculum-service (C1 Adaptive Curriculum Engine).

The engine keeps a prerequisite graph of concepts, a Bayesian Knowledge Tracing
mastery estimate per learner and concept, and ranks what each learner is ready
to study next with an explanation naming the weak prerequisite behind it.
"""

from __future__ import annotations

import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI

from app.api.v1.router import api_router
from app.api.v1.routes import dev, health
from app.config import get_settings
from app.core.errors import install_error_handlers
from app.core.logging import RequestContextMiddleware, configure_logging
from app.db.assessment_store import AssessmentStore
from app.db.graph_wiring import build_graph_runtime
from app.db.mastery_store import MasteryStore
from app.db.session import get_engine
from app.domain.learner import Learner
from app.domain.study import Study
from app.integrations.attempts import attempts_relation

SERVICE_NAME = "curriculum-service"
API_PREFIX = "/api/v1/curriculum"


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    yield
    app.state.graph_runtime.close()


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
        lifespan=lifespan,
    )

    # The graph is loaded on the first request and kept in memory; nothing
    # connects to a database at startup, so the service starts even when one is down.
    app.state.graph_runtime = build_graph_runtime(settings)
    app.state.learner = Learner(
        MasteryStore(get_engine(), attempts_relation(settings.integration_mode))
    )
    app.state.study = Study(AssessmentStore(get_engine()), app.state.learner)

    app.add_middleware(RequestContextMiddleware)
    install_error_handlers(app)

    # Health is served at both paths on purpose: /health for a direct probe of
    # this process, and <prefix>/health so it is reachable through the gateway,
    # which forwards the full path unchanged.
    app.include_router(health.router)
    app.include_router(health.router, prefix=API_PREFIX)
    app.include_router(api_router, prefix=API_PREFIX)
    if settings.dev_tools_enabled:
        app.include_router(dev.router, prefix=API_PREFIX)

    logging.getLogger(SERVICE_NAME).info(
        "service configured",
        extra={
            "environment": settings.environment,
            "port": settings.port,
            "integration_mode": settings.integration_mode,
            "graph_store": "neo4j" if settings.neo4j_enabled else "postgres-core",
            "dev_tools": settings.dev_tools_enabled,
        },
    )
    return app


app = create_app()
