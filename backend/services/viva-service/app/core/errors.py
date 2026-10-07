"""The shared error response format, identical in every AdaptLearn service.

    {"error": {"code": "...", "message": "...", "details": {}}}

Raise ApiError anywhere in the request path; the handlers registered by
install_error_handlers turn it into that shape.
"""

from __future__ import annotations

from typing import Any

from fastapi import FastAPI, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException


class ApiError(Exception):
    """An error with a stable machine-readable code."""

    def __init__(
        self,
        status_code: int,
        code: str,
        message: str,
        details: dict[str, Any] | None = None,
    ) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.code = code
        self.message = message
        self.details = details or {}


def error_body(code: str, message: str, details: dict[str, Any] | None = None) -> dict[str, Any]:
    return {"error": {"code": code, "message": message, "details": details or {}}}


def install_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(ApiError)
    async def _api_error(_: Request, exc: ApiError) -> JSONResponse:
        return JSONResponse(
            status_code=exc.status_code,
            content=error_body(exc.code, exc.message, exc.details),
        )

    @app.exception_handler(RequestValidationError)
    async def _validation_error(_: Request, exc: RequestValidationError) -> JSONResponse:
        return JSONResponse(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            content=error_body(
                "validation_error",
                "The request body or query parameters are invalid.",
                {"fields": _readable_fields(exc)},
            ),
        )

    @app.exception_handler(StarletteHTTPException)
    async def _http_error(_: Request, exc: StarletteHTTPException) -> JSONResponse:
        codes = {
            status.HTTP_401_UNAUTHORIZED: "unauthorized",
            status.HTTP_403_FORBIDDEN: "forbidden",
            status.HTTP_404_NOT_FOUND: "not_found",
            status.HTTP_405_METHOD_NOT_ALLOWED: "method_not_allowed",
            status.HTTP_409_CONFLICT: "conflict",
            status.HTTP_413_REQUEST_ENTITY_TOO_LARGE: "too_large",
            status.HTTP_415_UNSUPPORTED_MEDIA_TYPE: "unsupported_media_type",
            status.HTTP_422_UNPROCESSABLE_ENTITY: "validation_error",
            status.HTTP_429_TOO_MANY_REQUESTS: "rate_limited",
            status.HTTP_503_SERVICE_UNAVAILABLE: "service_unavailable",
        }
        code = codes.get(exc.status_code, "http_error")
        return JSONResponse(
            status_code=exc.status_code,
            content=error_body(code, str(exc.detail)),
            # Keep Retry-After on 429s so the frontend can show the wait.
            headers=getattr(exc, "headers", None),
        )


def _readable_fields(exc: RequestValidationError) -> dict[str, str]:
    """Turn pydantic's error list into {field: message} the frontend can show."""
    fields: dict[str, str] = {}
    for error in exc.errors():
        location = [str(part) for part in error["loc"] if part not in ("body", "query")]
        fields[".".join(location) or "body"] = error["msg"]
    return fields
