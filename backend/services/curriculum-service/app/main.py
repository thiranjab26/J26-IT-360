"""FastAPI application factory for curriculum-service (C1 Adaptive Curriculum Engine).

The engine keeps a prerequisite graph of concepts, a Bayesian Knowledge Tracing
mastery estimate per learner and concept, and ranks what each learner is ready
to study next with an explanation naming the weak prerequisite behind it.
"""

from __future__ import annotations

import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI

from app.api.v1.router import api_router
from app.api.v1.routes import dev, health, practice
from app.config import Settings, get_settings
from app.core.errors import install_error_handlers
from app.core.logging import RequestContextMiddleware, configure_logging
from app.db.assessment_store import AssessmentStore
from app.db.cohort_store import CohortStore
from app.db.feedback_store import FeedbackStore
from app.db.graph_wiring import build_graph_runtime
from app.db.mastery_store import MasteryStore
from app.db.paper_store import PaperStore
from app.db.practice_store import PracticeStore
from app.db.session import get_engine
from app.domain.assessment import choose_adaptive, choose_cell
from app.domain.gat import GatModel, ModelError, load_model
from app.domain.learner import Learner
from app.domain.papers import Papers
from app.domain.practice import Practice
from app.domain.study import Study
from app.integrations.attempts import attempts_relation

SERVICE_NAME = "curriculum-service"
API_PREFIX = "/api/v1/curriculum"
SERVICE_ROOT = Path(__file__).resolve().parents[1]


def load_readiness_model(settings: Settings) -> GatModel | None:
    """The GAT model, or None (rules-v1) when it is switched off, missing or rejected."""
    if not settings.model_path:
        return None
    path = Path(settings.model_path)
    path = path if path.is_absolute() else SERVICE_ROOT / path
    try:
        return load_model(path, path.with_name("feature_spec.json"), settings.model_sha256)
    except ModelError as exc:
        logging.getLogger(SERVICE_NAME).warning(
            "readiness model not loaded, using rules-v1", extra={"reason": str(exc)}
        )
        return None


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
        MasteryStore(get_engine(), attempts_relation(settings.integration_mode)),
        load_readiness_model(settings),
    )
    chooser = choose_adaptive if settings.group_assignment == "adaptive" else choose_cell
    app.state.study = Study(AssessmentStore(get_engine()), app.state.learner, chooser)
    app.state.practice = Practice(PracticeStore(get_engine()), app.state.learner)
    app.state.cohort = CohortStore(get_engine())
    app.state.papers = Papers(PaperStore(get_engine()))
    app.state.feedback = FeedbackStore(get_engine())

    app.add_middleware(RequestContextMiddleware)
    install_error_handlers(app)

    # Health is served at both paths on purpose: /health for a direct probe of
    # this process, and <prefix>/health so it is reachable through the gateway,
    # which forwards the full path unchanged.
    app.include_router(health.router)
    app.include_router(health.router, prefix=API_PREFIX)
    app.include_router(api_router, prefix=API_PREFIX)
    # The C3 stand-in exists only until C3 publishes tutor.v_attempt_outcomes.
    if settings.integration_mode == "stub":
        app.include_router(practice.router, prefix=API_PREFIX)
    if settings.dev_tools_enabled:
        app.include_router(dev.router, prefix=API_PREFIX)

    logging.getLogger(SERVICE_NAME).info(
        "service configured",
        extra={
            "environment": settings.environment,
            "port": settings.port,
            "integration_mode": settings.integration_mode,
            "graph_store": "neo4j" if settings.neo4j_enabled else "postgres (edits, then core)",
            "dev_tools": settings.dev_tools_enabled,
            "recommender": app.state.learner.recommender_version,
            "group_assignment": settings.group_assignment,
        },
    )
    return app


app = create_app()
