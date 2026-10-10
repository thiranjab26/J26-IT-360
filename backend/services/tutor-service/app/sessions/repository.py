"""Where sessions and their attempts are kept. The service talks to this protocol only.

`SqlSessionRepository` is the real one (tables in the `tutor` schema). Tests use an
in-memory twin, so the whole session flow is checked without a database, and a smaller
set of tests runs the SQL one against Neon inside a transaction that is rolled back.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import datetime
from typing import Protocol

from sqlalchemy import func, insert, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.db.tables import checkpoint_attempts, sessions
from app.sessions.state_machine import ExitReason, Phase, SessionState, Step


@dataclass(frozen=True)
class StoredSession:
    state: SessionState
    module_id: str
    policy: str


@dataclass(frozen=True)
class AttemptRecord:
    session_id: str
    question_id: str
    concept_id: str
    kind: str
    gating: bool
    attempt_no: int
    answer: str
    outcome: str  # correct | wrong | unreadable
    reason: str
    xp: int
    hints_used: int
    created_at: datetime


class SessionRepository(Protocol):
    def get(self, session_id: str, *, lock: bool = False) -> StoredSession | None: ...

    def get_active(self, user_id: str) -> StoredSession | None:
        """The student's unfinished session, locked for update, if they have one."""
        ...

    def create(self, stored: StoredSession) -> bool:
        """False, and nothing written, if the student already has an active session."""
        ...

    def save(self, stored: StoredSession) -> None: ...

    def add_attempt(self, record: AttemptRecord) -> None: ...

    def attempts(self, session_id: str) -> list[AttemptRecord]:
        """Every answer in one session, oldest first."""
        ...

    def gating_attempts(self, user_id: str) -> list[tuple[str, AttemptRecord]]:
        """(session_id, attempt) for every marked gating answer a student ever gave,
        oldest first. Unreadable answers are not attempts and are left out."""
        ...

    def total_xp(self, user_id: str) -> int: ...

    def seen_questions(self, user_id: str, concept_id: str) -> set[str]: ...


# ---------------------------------------------------------------------------- SQL
class SqlSessionRepository:
    def __init__(self, db: Session) -> None:
        self.db = db

    def get(self, session_id: str, *, lock: bool = False) -> StoredSession | None:
        try:
            key = uuid.UUID(session_id)
        except ValueError:
            return None
        query = select(sessions).where(sessions.c.session_id == key)
        if lock:
            query = query.with_for_update()
        row = self.db.execute(query).mappings().first()
        return _to_stored(row) if row else None

    def get_active(self, user_id: str) -> StoredSession | None:
        row = (
            self.db.execute(
                select(sessions)
                .where(sessions.c.user_id == uuid.UUID(user_id), sessions.c.ended_at.is_(None))
                .with_for_update()
            )
            .mappings()
            .first()
        )
        return _to_stored(row) if row else None

    def create(self, stored: StoredSession) -> bool:
        # A savepoint, so losing the race to the unique index does not poison the
        # request's transaction.
        try:
            with self.db.begin_nested():
                self.db.execute(insert(sessions).values(**_to_row(stored)))
        except IntegrityError:
            return False
        return True

    def save(self, stored: StoredSession) -> None:
        values = _to_row(stored)
        session_id = values.pop("session_id")
        for immutable in ("user_id", "module_id", "concept_id", "policy", "steps", "started_at"):
            values.pop(immutable)
        self.db.execute(
            update(sessions).where(sessions.c.session_id == session_id).values(**values)
        )

    def add_attempt(self, record: AttemptRecord) -> None:
        self.db.execute(
            insert(checkpoint_attempts).values(
                session_id=uuid.UUID(record.session_id),
                question_id=record.question_id,
                concept_id=record.concept_id,
                kind=record.kind,
                gating=record.gating,
                attempt_no=record.attempt_no,
                answer=record.answer,
                outcome=record.outcome,
                reason=record.reason,
                xp=record.xp,
                hints_used=record.hints_used,
                created_at=record.created_at,
            )
        )

    def attempts(self, session_id: str) -> list[AttemptRecord]:
        rows = self.db.execute(
            select(checkpoint_attempts)
            .where(checkpoint_attempts.c.session_id == uuid.UUID(session_id))
            .order_by(checkpoint_attempts.c.created_at, checkpoint_attempts.c.attempt_id)
        ).mappings()
        return [_to_attempt(r) for r in rows]

    def gating_attempts(self, user_id: str) -> list[tuple[str, AttemptRecord]]:
        rows = self.db.execute(
            select(checkpoint_attempts)
            .join(sessions, sessions.c.session_id == checkpoint_attempts.c.session_id)
            .where(
                sessions.c.user_id == uuid.UUID(user_id),
                checkpoint_attempts.c.gating,
                checkpoint_attempts.c.outcome.in_(("correct", "wrong")),
            )
            .order_by(checkpoint_attempts.c.created_at, checkpoint_attempts.c.attempt_id)
        ).mappings()
        return [(str(r["session_id"]), _to_attempt(r)) for r in rows]

    def total_xp(self, user_id: str) -> int:
        total = self.db.execute(
            select(func.coalesce(func.sum(checkpoint_attempts.c.xp), 0))
            .join(sessions, sessions.c.session_id == checkpoint_attempts.c.session_id)
            .where(sessions.c.user_id == uuid.UUID(user_id))
        ).scalar_one()
        return int(total)

    def seen_questions(self, user_id: str, concept_id: str) -> set[str]:
        rows = self.db.execute(
            select(checkpoint_attempts.c.question_id)
            .join(sessions, sessions.c.session_id == checkpoint_attempts.c.session_id)
            .where(
                sessions.c.user_id == uuid.UUID(user_id),
                checkpoint_attempts.c.concept_id == concept_id,
            )
            .distinct()
        )
        return {r[0] for r in rows}


def _to_row(stored: StoredSession) -> dict:
    s = stored.state
    return {
        "session_id": uuid.UUID(s.session_id),
        "user_id": uuid.UUID(s.user_id),
        "module_id": stored.module_id,
        "concept_id": s.concept_id,
        "policy": stored.policy,
        "steps": [{"kind": x.kind, "ref": x.ref, "gating": x.gating} for x in s.steps],
        "step_index": s.index,
        "phase": s.phase.value,
        "attempts": s.attempts,
        "last_outcome": s.last_outcome,
        "passed": list(s.passed),
        "passed_gating": list(s.passed_gating),
        "exit_reason": s.exit.value if s.exit else None,
        "started_at": s.started_at,
        "last_activity_at": s.last_activity_at,
        "ended_at": s.ended_at,
    }


def _to_stored(row) -> StoredSession:
    state = SessionState(
        session_id=str(row["session_id"]),
        user_id=str(row["user_id"]),
        concept_id=row["concept_id"],
        steps=tuple(Step(x["kind"], x["ref"], x["gating"]) for x in row["steps"]),
        index=row["step_index"],
        phase=Phase(row["phase"]),
        started_at=row["started_at"],
        last_activity_at=row["last_activity_at"],
        attempts=row["attempts"],
        last_outcome=row["last_outcome"],
        passed=tuple(row["passed"]),
        passed_gating=tuple(row["passed_gating"]),
        exit=ExitReason(row["exit_reason"]) if row["exit_reason"] else None,
        ended_at=row["ended_at"],
    )
    return StoredSession(state, row["module_id"], row["policy"])


def _to_attempt(row) -> AttemptRecord:
    return AttemptRecord(
        session_id=str(row["session_id"]),
        question_id=row["question_id"],
        concept_id=row["concept_id"],
        kind=row["kind"],
        gating=row["gating"],
        attempt_no=row["attempt_no"],
        answer=row["answer"],
        outcome=row["outcome"],
        reason=row["reason"],
        xp=row["xp"],
        hints_used=row["hints_used"],
        created_at=row["created_at"],
    )
