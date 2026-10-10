"""An in-memory twin of SqlSessionRepository, and a clock, for testing the session service."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

from app.sessions.repository import AttemptRecord, StoredSession, StoredText


class InMemorySessionRepository:
    def __init__(self) -> None:
        self.sessions: dict[str, StoredSession] = {}
        self._attempts: list[AttemptRecord] = []
        self.texts: dict[tuple[str, str], StoredText] = {}

    def get(self, session_id: str, *, lock: bool = False) -> StoredSession | None:
        return self.sessions.get(session_id)

    def get_active(self, user_id: str) -> StoredSession | None:
        return next(
            (
                s
                for s in self.sessions.values()
                if s.state.user_id == user_id and not s.state.is_over
            ),
            None,
        )

    def create(self, stored: StoredSession) -> bool:
        if self.get_active(stored.state.user_id) is not None:
            return False
        self.sessions[stored.state.session_id] = stored
        return True

    def save(self, stored: StoredSession) -> None:
        active = self.get_active(stored.state.user_id)
        if (
            not stored.state.is_over
            and active is not None
            and active.state.session_id != stored.state.session_id
        ):
            raise AssertionError("two active sessions for one student (the database forbids it)")
        self.sessions[stored.state.session_id] = stored

    def add_attempt(self, record: AttemptRecord) -> None:
        self._attempts.append(record)

    def attempts(self, session_id: str) -> list[AttemptRecord]:
        return [a for a in self._attempts if a.session_id == session_id]

    def gating_attempts(self, user_id: str) -> list[tuple[str, AttemptRecord]]:
        return [
            (a.session_id, a)
            for a in self._attempts
            if self.sessions[a.session_id].state.user_id == user_id
            and a.gating
            and a.outcome in ("correct", "wrong")
        ]

    def get_text(self, session_id: str, key: str) -> StoredText | None:
        return self.texts.get((session_id, key))

    def put_text(self, session_id: str, key: str, text: StoredText) -> None:
        self.texts.setdefault((session_id, key), text)

    def total_xp(self, user_id: str) -> int:
        return sum(
            a.xp for a in self._attempts if self.sessions[a.session_id].state.user_id == user_id
        )

    def seen_questions(self, user_id: str, concept_id: str) -> set[str]:
        return {
            a.question_id
            for a in self._attempts
            if self.sessions[a.session_id].state.user_id == user_id and a.concept_id == concept_id
        }


class Clock:
    """A clock that only moves when told to, one second per reading so order is strict."""

    def __init__(self) -> None:
        self.now = datetime(2026, 10, 10, 9, 0, tzinfo=UTC)

    def __call__(self) -> datetime:
        self.now += timedelta(seconds=1)
        return self.now

    def advance(self, **kwargs: float) -> None:
        self.now += timedelta(**kwargs)
