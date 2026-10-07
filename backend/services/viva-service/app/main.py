"""FastAPI application factory for viva-service (C4 Intelligent Viva System).

Routes live under /api/v1/viva. The viva keeps its own participant and staff login for now
(app/core/auth.py); moving to the shared gateway login is a later step.
"""

from __future__ import annotations

import hashlib
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import text
from starlette.concurrency import run_in_threadpool

from app.api.v1.router import api_router
from app.api.v1.routes import health
from app.config import settings
from app.core import limits
from app.core.auth import lookup
from app.core.errors import error_body, install_error_handlers
from app.core.logging import RequestContextMiddleware, configure_logging
from app.db.session import SessionLocal, engine
from app.db.tables import Base
from app.domain.seed import seed
from app.integrations import speech
from app.integrations.llm import ProviderUnavailable

SERVICE_NAME = "viva-service"
API_PREFIX = "/api/v1/viva"
AUTH_PATHS = (f"{API_PREFIX}/auth/participant", f"{API_PREFIX}/auth/staff")


@asynccontextmanager
async def lifespan(_app: FastAPI):
    cfg = settings()
    cfg.validate_deployment()
    # Tests (SQLite) and the prototype create tables directly; the team process is
    # `uv run alembic upgrade head`, which builds the same tables in the viva schema.
    if engine.dialect.name == "sqlite" or cfg.create_tables_on_startup:
        if engine.dialect.name == "postgresql":
            with engine.begin() as connection:
                connection.execute(text(f'CREATE SCHEMA IF NOT EXISTS "{cfg.db_schema}"'))
        Base.metadata.create_all(engine)
    if cfg.seed_demo_bank:
        with SessionLocal() as db:
            seed(db)
    if cfg.speech_warmup and cfg.speech_provider == "faster_whisper":
        await run_in_threadpool(speech.model)
    yield


def create_app() -> FastAPI:
    cfg = settings()
    configure_logging(cfg.log_level)
    app = FastAPI(
        title=SERVICE_NAME,
        version="1.1.0",
        description="C4 Intelligent Viva System. Adaptive spoken viva with knowledge and communication gap evidence.",
        docs_url="/docs",
        openapi_url="/openapi.json",
        lifespan=lifespan,
    )

    @app.middleware("http")
    async def api_limits(request, call_next):
        path = request.url.path
        if (
            not path.startswith(API_PREFIX)
            or request.method == "OPTIONS"
            or path.endswith("/health")
        ):
            return await call_next(request)
        host = request.client.host if request.client else "unknown"

        def admit():
            identity = "ip:" + hashlib.sha256(host.encode()).hexdigest()
            header = request.headers.get("authorization", "")
            if header.lower().startswith("bearer "):
                with SessionLocal() as db:
                    user = lookup(db, header[7:])
                    if user:
                        identity = user.id
            if path in AUTH_PATHS:
                limits.hit(f"auth:{host}", 60, cfg.auth_requests_per_minute)
            limits.hit(f"api:{identity}", 60, cfg.api_requests_per_minute)
            return identity

        try:
            identity = await run_in_threadpool(admit)
        except HTTPException as exc:
            return JSONResponse(
                status_code=exc.status_code,
                content=error_body("rate_limited", str(exc.detail)),
                headers=exc.headers,
            )
        marker = limits.actor.set(identity)
        try:
            return await call_next(request)
        finally:
            limits.actor.reset(marker)

    app.add_middleware(RequestContextMiddleware)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=cfg.allowed_origins.split(","),
        allow_credentials=False,
        allow_methods=["GET", "POST", "PUT"],
        allow_headers=["Authorization", "Content-Type"],
        expose_headers=["Retry-After"],
    )
    install_error_handlers(app)

    @app.exception_handler(ProviderUnavailable)
    async def provider_error(_request, exc):
        return JSONResponse(status_code=503, content=error_body("provider_unavailable", str(exc)))

    # Health at /health for a direct probe and at <prefix>/health through the gateway.
    app.include_router(health.router)
    app.include_router(api_router, prefix=API_PREFIX)

    logging.getLogger(SERVICE_NAME).info(
        "service configured",
        extra={
            "environment": cfg.environment,
            "port": cfg.port,
            "integration_mode": cfg.integration_mode,
        },
    )
    return app


app = create_app()
