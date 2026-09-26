"""Request and response schemas for the auth API.

Students and lecturers register through separate endpoints with different
required fields, so each role gets its own request model rather than one model
with a role field the client could set freely.
"""

from __future__ import annotations

import uuid
from typing import Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator

from app.core.security import MAX_PASSWORD_BYTES

Role = Literal["student", "lecturer"]


class _Credentials(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=MAX_PASSWORD_BYTES)

    @field_validator("password")
    @classmethod
    def password_fits_bcrypt(cls, value: str) -> str:
        if len(value.encode("utf-8")) > MAX_PASSWORD_BYTES:
            raise ValueError(f"Password must be at most {MAX_PASSWORD_BYTES} bytes once encoded.")
        return value

    @field_validator("email")
    @classmethod
    def normalise_email(cls, value: str) -> str:
        return value.strip().lower()


class StudentRegistration(_Credentials):
    full_name: str = Field(min_length=2, max_length=120)
    student_number: str = Field(min_length=3, max_length=32)

    @field_validator("full_name", "student_number")
    @classmethod
    def strip(cls, value: str) -> str:
        return value.strip()


class LecturerRegistration(_Credentials):
    full_name: str = Field(min_length=2, max_length=120)
    department: str | None = Field(default=None, max_length=120)

    @field_validator("full_name")
    @classmethod
    def strip_name(cls, value: str) -> str:
        return value.strip()


class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=MAX_PASSWORD_BYTES)

    @field_validator("email")
    @classmethod
    def normalise_email(cls, value: str) -> str:
        return value.strip().lower()


class UserProfile(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    user_id: uuid.UUID
    email: EmailStr
    full_name: str
    role: str
    student_number: str | None = None
    department: str | None = None


class AuthResponse(BaseModel):
    """What the frontend stores after a successful register or login."""

    access_token: str
    token_type: Literal["bearer"] = "bearer"
    expires_in: int
    user: UserProfile
