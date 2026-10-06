"""Request dependencies: who is calling, according to the gateway.

Architecture rule 2: the browser talks only to the gateway, the gateway verifies
the JWT, and services read the identity from headers. This service never parses
a JWT and never sees the signing secret.

Two rules follow for every route in this service:

1. A learner's own data is reached through /me routes that take the user id
   from `current_user`, never from the URL or the body. That makes reading
   another learner's mastery impossible by construction.
2. Staff-only routes declare `Depends(require_role("lecturer", "admin"))`.
"""

from __future__ import annotations

import uuid
from collections.abc import Callable
from dataclasses import dataclass

from fastapi import Depends, Header, status

from app.core.errors import ApiError

STAFF_ROLES = frozenset({"lecturer", "admin"})


@dataclass(frozen=True)
class CurrentUser:
    user_id: uuid.UUID
    role: str

    @property
    def is_student(self) -> bool:
        return self.role == "student"

    @property
    def is_staff(self) -> bool:
        return self.role in STAFF_ROLES


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


def require_role(*roles: str) -> Callable[[CurrentUser], CurrentUser]:
    """Dependency factory: allow only callers whose role is one of `roles`."""
    allowed = frozenset(roles)

    def _check(caller: CurrentUser = Depends(current_user)) -> CurrentUser:
        if caller.role not in allowed:
            raise ApiError(
                status.HTTP_403_FORBIDDEN,
                "forbidden",
                "You do not have permission to use this endpoint.",
            )
        return caller

    return _check
