"""Password hashing and token issuing, with no database involved."""

from __future__ import annotations

import uuid

import pytest

from app.config import Settings
from app.core.security import (
    MAX_PASSWORD_BYTES,
    create_access_token,
    decode_access_token,
    hash_password,
    verify_password,
)


@pytest.fixture
def settings() -> Settings:
    return Settings(
        DATABASE_URL="postgresql+psycopg://user:pw@localhost/db",
        AUTH_JWT_SECRET="test-secret-not-used-anywhere-real-and-long-enough-for-hs256",
    )


def test_hash_is_salted_and_verifies() -> None:
    first = hash_password("correct horse battery")
    second = hash_password("correct horse battery")

    assert first != second, "each hash must use a fresh salt"
    assert verify_password("correct horse battery", first)
    assert verify_password("correct horse battery", second)


def test_wrong_password_is_rejected() -> None:
    stored = hash_password("correct horse battery")
    assert not verify_password("Correct horse battery", stored)
    assert not verify_password("", stored)


def test_malformed_hash_is_a_failed_login_not_a_crash() -> None:
    assert not verify_password("anything", "not-a-bcrypt-hash")


def test_bcrypt_limit_is_documented_and_enforced_by_schema() -> None:
    # bcrypt ignores bytes past 72, which is why the request schema caps length.
    # This test pins the constant the schema depends on.
    assert MAX_PASSWORD_BYTES == 72


def test_token_carries_the_claims_the_gateway_forwards(settings: Settings) -> None:
    user_id = uuid.uuid4()
    token, expires_in = create_access_token(
        settings, user_id=user_id, role="student", email="s@example.com"
    )

    claims = decode_access_token(settings, token)

    assert claims["sub"] == str(user_id)
    assert claims["role"] == "student"
    assert claims["iss"] == settings.jwt_issuer
    assert expires_in == settings.access_token_ttl_minutes * 60


def test_token_signed_with_another_secret_is_rejected(settings: Settings) -> None:
    import jwt

    token, _ = create_access_token(
        settings, user_id=uuid.uuid4(), role="student", email="s@example.com"
    )
    other = settings.model_copy(
        update={"jwt_secret": "a-different-secret-also-long-enough-for-hs256-hmac"}
    )

    with pytest.raises(jwt.InvalidSignatureError):
        decode_access_token(other, token)
