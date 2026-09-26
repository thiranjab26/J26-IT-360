"""Request schema validation: the rules the frontend forms rely on."""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from app.models.auth import LecturerRegistration, LoginRequest, StudentRegistration


def test_student_registration_normalises_email_and_trims_names() -> None:
    payload = StudentRegistration(
        email="  Student@My.SLIIT.LK ",
        password="a-good-password",
        full_name="  Tharindu Dushan  ",
        student_number=" IT23252622 ",
    )

    assert payload.email == "student@my.sliit.lk"
    assert payload.full_name == "Tharindu Dushan"
    assert payload.student_number == "IT23252622"


def test_short_password_is_rejected() -> None:
    with pytest.raises(ValidationError):
        StudentRegistration(
            email="s@example.com",
            password="short",
            full_name="A Student",
            student_number="IT1",
        )


def test_password_longer_than_bcrypt_accepts_is_rejected() -> None:
    with pytest.raises(ValidationError):
        StudentRegistration(
            email="s@example.com",
            password="x" * 73,
            full_name="A Student",
            student_number="IT1",
        )


def test_student_number_is_required_for_students() -> None:
    with pytest.raises(ValidationError):
        StudentRegistration(
            email="s@example.com",
            password="a-good-password",
            full_name="A Student",
        )


def test_lecturer_department_is_optional() -> None:
    payload = LecturerRegistration(
        email="l@example.com",
        password="a-good-password",
        full_name="A Lecturer",
    )
    assert payload.department is None


def test_login_normalises_email() -> None:
    assert LoginRequest(email="A@B.COM", password="x").email == "a@b.com"
