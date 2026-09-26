"""User registration and authentication. No FastAPI imports in this layer."""

from __future__ import annotations

import uuid

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.security import hash_password, verify_password
from app.db.tables import User


class EmailAlreadyRegistered(Exception):
    def __init__(self, email: str) -> None:
        super().__init__(email)
        self.email = email


class StudentNumberAlreadyRegistered(Exception):
    def __init__(self, student_number: str) -> None:
        super().__init__(student_number)
        self.student_number = student_number


class InvalidCredentials(Exception):
    pass


class AccountDisabled(Exception):
    pass


def find_by_email(session: Session, email: str) -> User | None:
    statement = select(User).where(func.lower(User.email) == email.strip().lower())
    return session.scalars(statement).one_or_none()


def find_by_id(session: Session, user_id: uuid.UUID) -> User | None:
    return session.get(User, user_id)


def register(
    session: Session,
    *,
    email: str,
    password: str,
    full_name: str,
    role: str,
    student_number: str | None = None,
    department: str | None = None,
) -> User:
    """Create a user. Raises if the email or student number is already taken.

    The pre-checks give a clean field-level error for the common case; the
    IntegrityError handler below is what actually guarantees uniqueness, since
    two concurrent registrations can both pass the pre-check.
    """
    if find_by_email(session, email) is not None:
        raise EmailAlreadyRegistered(email)

    if student_number is not None:
        exists = session.scalars(
            select(User).where(User.student_number == student_number)
        ).one_or_none()
        if exists is not None:
            raise StudentNumberAlreadyRegistered(student_number)

    user = User(
        email=email.strip().lower(),
        password_hash=hash_password(password),
        full_name=full_name.strip(),
        role=role,
        student_number=student_number,
        department=department,
    )
    session.add(user)
    try:
        session.flush()
    except IntegrityError as exc:
        session.rollback()
        constraint = str(getattr(exc.orig, "diag", None) and exc.orig.diag.constraint_name or "")
        if "student_number" in constraint:
            raise StudentNumberAlreadyRegistered(student_number or "") from exc
        raise EmailAlreadyRegistered(email) from exc

    session.refresh(user)
    return user


def authenticate(session: Session, *, email: str, password: str) -> User:
    user = find_by_email(session, email)

    # Verify against a dummy hash when the user does not exist so that a missing
    # account and a wrong password take about the same time to answer.
    if user is None:
        verify_password(password, "$2b$12$" + "." * 53)
        raise InvalidCredentials

    if not verify_password(password, user.password_hash):
        raise InvalidCredentials

    if not user.is_active:
        raise AccountDisabled

    return user
