"""Identity comes from the gateway headers and nowhere else."""

from __future__ import annotations

import uuid

import pytest

from app.core.deps import CurrentUser, current_user, require_role
from app.core.errors import ApiError


def test_headers_from_the_gateway_are_accepted() -> None:
    user_id = uuid.uuid4()
    caller = current_user(x_user_id=str(user_id), x_user_role="student")

    assert caller.user_id == user_id
    assert caller.is_student
    assert not caller.is_staff


@pytest.mark.parametrize("role", ["lecturer", "admin"])
def test_lecturers_and_admins_are_staff(role: str) -> None:
    caller = current_user(x_user_id=str(uuid.uuid4()), x_user_role=role)
    assert caller.is_staff
    assert not caller.is_student


@pytest.mark.parametrize(
    ("user_id", "role"),
    [(None, None), (None, "student"), ("abc", None)],
)
def test_missing_headers_are_rejected(user_id: str | None, role: str | None) -> None:
    with pytest.raises(ApiError) as caught:
        current_user(x_user_id=user_id, x_user_role=role)

    assert caught.value.status_code == 401
    assert caught.value.code == "unauthorized"


def test_a_malformed_user_id_is_a_400_not_a_crash() -> None:
    with pytest.raises(ApiError) as caught:
        current_user(x_user_id="not-a-uuid", x_user_role="student")

    assert caught.value.status_code == 400
    assert caught.value.code == "bad_user_header"


def test_require_role_lets_an_allowed_role_through() -> None:
    check = require_role("lecturer", "admin")
    caller = current_user(x_user_id=str(uuid.uuid4()), x_user_role="lecturer")

    assert check(caller) is caller


@pytest.mark.parametrize("role", ["student", "unknown", ""])
def test_require_role_blocks_everyone_else_with_403(role: str) -> None:
    check = require_role("lecturer", "admin")
    caller = CurrentUser(user_id=uuid.uuid4(), role=role)

    with pytest.raises(ApiError) as caught:
        check(caller)

    assert caught.value.status_code == 403
    assert caught.value.code == "forbidden"
