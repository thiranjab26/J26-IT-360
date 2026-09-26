"""Registration and login.

Students and lecturers register at separate endpoints. The role is decided by
which endpoint was called, never by a field in the request body, so a client
cannot register itself as a lecturer through the student form.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, status
from sqlalchemy.orm import Session

from app.config import Settings, get_settings
from app.core.deps import CurrentUser, current_user
from app.core.errors import ApiError
from app.core.security import create_access_token
from app.db.session import get_session
from app.domain import users as users_domain
from app.models.auth import (
    AuthResponse,
    LecturerRegistration,
    LoginRequest,
    StudentRegistration,
    UserProfile,
)

router = APIRouter(tags=["auth"])


def _auth_response(settings: Settings, user) -> AuthResponse:  # noqa: ANN001
    token, expires_in = create_access_token(
        settings, user_id=user.user_id, role=user.role, email=user.email
    )
    return AuthResponse(
        access_token=token,
        expires_in=expires_in,
        user=UserProfile.model_validate(user),
    )


@router.post(
    "/register/student",
    response_model=AuthResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Register a student and return an access token",
)
def register_student(
    payload: StudentRegistration,
    session: Session = Depends(get_session),
    settings: Settings = Depends(get_settings),
) -> AuthResponse:
    try:
        user = users_domain.register(
            session,
            email=payload.email,
            password=payload.password,
            full_name=payload.full_name,
            role="student",
            student_number=payload.student_number,
        )
    except users_domain.EmailAlreadyRegistered as exc:
        raise ApiError(
            status.HTTP_409_CONFLICT,
            "email_taken",
            "An account with this email already exists.",
            {"field": "email"},
        ) from exc
    except users_domain.StudentNumberAlreadyRegistered as exc:
        raise ApiError(
            status.HTTP_409_CONFLICT,
            "student_number_taken",
            "An account with this student number already exists.",
            {"field": "student_number"},
        ) from exc

    return _auth_response(settings, user)


@router.post(
    "/register/lecturer",
    response_model=AuthResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Register a lecturer and return an access token",
)
def register_lecturer(
    payload: LecturerRegistration,
    session: Session = Depends(get_session),
    settings: Settings = Depends(get_settings),
) -> AuthResponse:
    try:
        user = users_domain.register(
            session,
            email=payload.email,
            password=payload.password,
            full_name=payload.full_name,
            role="lecturer",
            department=payload.department,
        )
    except users_domain.EmailAlreadyRegistered as exc:
        raise ApiError(
            status.HTTP_409_CONFLICT,
            "email_taken",
            "An account with this email already exists.",
            {"field": "email"},
        ) from exc

    return _auth_response(settings, user)


@router.post(
    "/login",
    response_model=AuthResponse,
    summary="Exchange email and password for an access token",
)
def login(
    payload: LoginRequest,
    session: Session = Depends(get_session),
    settings: Settings = Depends(get_settings),
) -> AuthResponse:
    try:
        user = users_domain.authenticate(session, email=payload.email, password=payload.password)
    except users_domain.InvalidCredentials as exc:
        # One message for both a missing account and a wrong password: telling
        # them apart tells an attacker which emails are registered.
        raise ApiError(
            status.HTTP_401_UNAUTHORIZED,
            "invalid_credentials",
            "Email or password is incorrect.",
        ) from exc
    except users_domain.AccountDisabled as exc:
        raise ApiError(
            status.HTTP_403_FORBIDDEN,
            "account_disabled",
            "This account has been disabled. Contact your lecturer.",
        ) from exc

    return _auth_response(settings, user)


@router.get(
    "/me",
    response_model=UserProfile,
    summary="The signed-in user, resolved from the gateway headers",
)
def me(
    caller: CurrentUser = Depends(current_user),
    session: Session = Depends(get_session),
) -> UserProfile:
    user = users_domain.find_by_id(session, caller.user_id)
    if user is None:
        raise ApiError(
            status.HTTP_404_NOT_FOUND,
            "user_not_found",
            "The signed-in user no longer exists.",
        )
    return UserProfile.model_validate(user)
