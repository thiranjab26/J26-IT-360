"""Request dependencies: who is calling, according to the gateway.

Architecture rule 2: the browser talks only to the gateway, the gateway verifies
the JWT, and services read the identity from headers. This service never parses
a JWT and never sees the signing secret.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass

from fastapi import Header, status

from app.core.errors import ApiError


@dataclass(frozen=True)
class CurrentUser:
    user_id: uuid.UUID
    role: str

    @property
    def is_student(self) -> bool:
        return self.role == "student"


def current_user(
    x_user_id: str | None = Header(default=None, alias="X-User-Id"),
    x_user_role: str | None = Header(default=None, alias="X-User-Role"),
) -> CurrentUser:
    if not x_user_id or not x_user_role:
        raise ApiError(
            status.HTTP_401_UNAUTHORIZED,
            "unauthorized",
            "Authentication required. Call this service through the gateway.",
        )

    try:
        return CurrentUser(user_id=uuid.UUID(x_user_id), role=x_user_role)
    except ValueError as exc:
        raise ApiError(
            status.HTTP_400_BAD_REQUEST,
            "bad_user_header",
            "X-User-Id is not a valid UUID.",
        ) from exc
