from datetime import UTC, datetime
from uuid import uuid4

from sqlalchemy import JSON, ForeignKey, Integer, MetaData, String, Text, UniqueConstraint
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

from app.config import settings


def now():
    return datetime.now(UTC).isoformat()


def uid():
    return str(uuid4())


class Base(DeclarativeBase):
    # Every C4 table lives in the service's own schema (ADR 0002). String foreign keys
    # without a schema resolve inside it.
    metadata = MetaData(schema=settings().db_schema)


class Course(Base):
    __tablename__ = "courses"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=uid)
    name: Mapped[str] = mapped_column(String(150))
    description: Mapped[str] = mapped_column(Text)
    created_by: Mapped[str] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[str] = mapped_column(String, default=now)


class Material(Base):
    __tablename__ = "course_materials"
    __table_args__ = (UniqueConstraint("course_id", "digest"),)
    id: Mapped[str] = mapped_column(String, primary_key=True, default=uid)
    course_id: Mapped[str] = mapped_column(ForeignKey("courses.id"), index=True)
    digest: Mapped[str] = mapped_column(String)
    name: Mapped[str] = mapped_column(String(200))
    chunks: Mapped[list] = mapped_column(JSON)


class UsageCounter(Base):
    __tablename__ = "usage_counters"
    key: Mapped[str] = mapped_column(String(250), primary_key=True)
    used: Mapped[int] = mapped_column(Integer)
    expires: Mapped[int] = mapped_column(Integer, index=True)


class User(Base):
    __tablename__ = "users"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=uid)
    participant_code: Mapped[str] = mapped_column(String(64))
    role: Mapped[str] = mapped_column(String(20))
    staff_identity: Mapped[str | None] = mapped_column(String, unique=True, nullable=True)


class Token(Base):
    __tablename__ = "auth_tokens"
    digest: Mapped[str] = mapped_column(String, primary_key=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"))
    expires_at: Mapped[str] = mapped_column(String)


class Bank(Base):
    __tablename__ = "generated_question_bank"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=uid)
    topic_id: Mapped[str] = mapped_column(String, index=True)
    status: Mapped[str] = mapped_column(String, index=True)
    data: Mapped[dict] = mapped_column(JSON)


class VivaSession(Base):
    __tablename__ = "viva_sessions"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=uid)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    status: Mapped[str] = mapped_column(String)
    version: Mapped[int] = mapped_column(Integer, default=1)
    data: Mapped[dict] = mapped_column(JSON)


class Turn(Base):
    __tablename__ = "viva_turns"
    __table_args__ = (
        UniqueConstraint("session_id", "request_id"),
        UniqueConstraint("session_id", "question_id"),
    )
    id: Mapped[str] = mapped_column(String, primary_key=True, default=uid)
    session_id: Mapped[str] = mapped_column(ForeignKey("viva_sessions.id"), index=True)
    question_id: Mapped[str] = mapped_column(String)
    request_id: Mapped[str] = mapped_column(String(128))
    request_digest: Mapped[str] = mapped_column(String)
    data: Mapped[dict] = mapped_column(JSON)
    response: Mapped[dict] = mapped_column(JSON)


class Result(Base):
    __tablename__ = "viva_results"
    session_id: Mapped[str] = mapped_column(ForeignKey("viva_sessions.id"), primary_key=True)
    data: Mapped[dict] = mapped_column(JSON)


class IntegrationEvent(Base):
    __tablename__ = "integration_events"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=uid)
    session_id: Mapped[str] = mapped_column(ForeignKey("viva_sessions.id"), index=True)
    data: Mapped[dict] = mapped_column(JSON)


class HumanRating(Base):
    __tablename__ = "human_ratings"
    __table_args__ = (UniqueConstraint("rater_id", "case_id", "condition"),)
    id: Mapped[str] = mapped_column(String, primary_key=True, default=uid)
    rater_id: Mapped[str] = mapped_column(ForeignKey("users.id"))
    case_id: Mapped[str] = mapped_column(String)
    condition: Mapped[str] = mapped_column(String(1))
    data: Mapped[dict] = mapped_column(JSON)
