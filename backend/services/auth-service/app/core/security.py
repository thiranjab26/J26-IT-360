"""Password hashing and JWT issuing.

This is the only service that hashes passwords or signs tokens. Every other
service trusts the gateway headers instead (see core/deps.py), which is why
nothing downstream needs the signing secret.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

import bcrypt
import jwt

from app.config import Settings

# bcrypt silently ignores everything past 72 bytes, so the request schema caps
# password length rather than letting a longer password be quietly truncated.
MAX_PASSWORD_BYTES = 72


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode("utf-8"), password_hash.encode("utf-8"))
    except ValueError:
        # Malformed stored hash. Treat as a failed login rather than a 500.
        return False


def create_access_token(
    settings: Settings,
    *,
    user_id: uuid.UUID,
    role: str,
    email: str,
) -> tuple[str, int]:
    """Return (token, expires_in_seconds).

    The gateway verifies this token and forwards `sub` as X-User-Id and `role`
    as X-User-Role, so these two claims are the contract with every service.
    """
    ttl = timedelta(minutes=settings.access_token_ttl_minutes)
    now = datetime.now(tz=UTC)
    claims: dict[str, Any] = {
        "sub": str(user_id),
        "role": role,
        "email": email,
        "iss": settings.jwt_issuer,
        "iat": int(now.timestamp()),
        "exp": int((now + ttl).timestamp()),
    }
    token = jwt.encode(claims, settings.jwt_secret, algorithm=settings.jwt_algorithm)
    return token, int(ttl.total_seconds())


def decode_access_token(settings: Settings, token: str) -> dict[str, Any]:
    """Verify a token locally. Used by GET /me when called without the gateway."""
    return jwt.decode(
        token,
        settings.jwt_secret,
        algorithms=[settings.jwt_algorithm],
        issuer=settings.jwt_issuer,
    )
