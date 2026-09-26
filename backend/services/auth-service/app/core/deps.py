"""Request dependencies: who is calling, according to the gateway.

Architecture rule 2: the browser only talks to the gateway, the gateway verifies
the JWT, and services read the identity from headers. A service never parses a
JWT off the wire.

auth-service is the one exception, and only as a convenience: if a request
arrives with a Bearer token and no gateway headers (for example curl straight at
port 8001 during development), it verifies the token itself. In production the
gateway is always in front and the header path is the one that runs.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass

from fastapi import Depends, Header, Request, status

from app.config import Settings, get_settings
from app.core.errors import ApiError


@dataclass(frozen=True)
class CurrentUser:
    user_id: uuid.UUID
    role: str


def current_user(
    request: Request,
    x_user_id: str | None = Header(default=None, alias="X-User-Id"),
    x_user_role: str | None = Header(default=None, alias="X-User-Role"),
    settings: Settings = Depends(get_settings),
) -> CurrentUser:
    if x_user_id and x_user_role:
        try:
            return CurrentUser(user_id=uuid.UUID(x_user_id), role=x_user_role)
        except ValueError as exc:
            raise ApiError(
                status.HTTP_400_BAD_REQUEST,
                "bad_user_header",
                "X-User-Id is not a valid UUID.",
            ) from exc

    token = _bearer_token(request)
    if token is None:
        raise ApiError(
            status.HTTP_401_UNAUTHORIZED,
            "unauthorized",
            "Authentication required.",
        )

    from app.core.security import decode_access_token  # local import avoids a cycle

    try:
        claims = decode_access_token(settings, token)
        return CurrentUser(user_id=uuid.UUID(claims["sub"]), role=str(claims["role"]))
    except Exception as exc:
        raise ApiError(
            status.HTTP_401_UNAUTHORIZED,
            "invalid_token",
            "The access token is missing, expired or invalid.",
        ) from exc


def _bearer_token(request: Request) -> str | None:
    header = request.headers.get("authorization", "")
    scheme, _, value = header.partition(" ")
    if scheme.lower() != "bearer" or not value.strip():
        return None
    return value.strip()
