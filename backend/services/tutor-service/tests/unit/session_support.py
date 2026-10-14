"""An in-memory twin of SqlSessionRepository, and a clock, for testing the session service."""

from __future__ import annotations

from datetime import UTC, date, datetime, timedelta

from app.sessions.repository import (
    AttemptRecord,
    CachedExplanation,
    GateEvent,
    LeaderRow,
    SessionReward,
    StoredSession,
    StoredText,
)


class InMemorySessionRepository:
    def __init__(self) -> None:
        self.sessions: dict[str, StoredSession] = {}
        self._attempts: list[AttemptRecord] = []
        self.texts: dict[tuple[str, str], StoredText] = {}
        self.gate_events: list[GateEvent] = []
        self.verified: dict[tuple[str, str, str], CachedExplanation] = {}
        self.bonus: list[tuple[str, str | None, str, str, int]] = []  # user, session, kind, ref, xp
        self.held: dict[tuple[str, str], tuple[str | None, datetime]] = {}
        self.names: dict[str, str] = {}
        self.clock = lambda: datetime.now(UTC)

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

    def session_texts(self, session_id: str) -> dict[str, StoredText]:
        return {k: v for (s, k), v in self.texts.items() if s == session_id}

    def commit(self) -> None:
        pass

    def get_verified(self, passage_id: str, passage_hash: str, fingerprint: str):
        return self.verified.get((passage_id, passage_hash, fingerprint))

    def put_verified(self, passage_id, passage_hash, fingerprint, entry) -> None:
        self.verified.setdefault((passage_id, passage_hash, fingerprint), entry)

    def add_gate_events(self, events) -> None:
        self.gate_events.extend(events)

    def total_xp(self, user_id: str) -> int:
        points = sum(
            a.xp for a in self._attempts if self.sessions[a.session_id].state.user_id == user_id
        )
        return points + sum(b[4] for b in self.bonus if b[0] == user_id)

    def add_xp_event(self, user_id, session_id, kind, ref, amount) -> bool:
        if any(b[0] == user_id and b[2] == kind and b[3] == ref for b in self.bonus):
            return False
        self.bonus.append((user_id, session_id, kind, ref, amount))
        return True

    def award_badge(self, user_id, badge_id, session_id) -> bool:
        if (user_id, badge_id) in self.held:
            return False
        self.held[(user_id, badge_id)] = (session_id, self.clock())
        return True

    def badges(self, user_id):
        return {b: at for (u, b), (_, at) in self.held.items() if u == user_id}

    def session_rewards(self, session_id):
        return [SessionReward(k, r, a) for _, s, k, r, a in self.bonus if s == session_id] + [
            SessionReward("badge", b, 0) for (_, b), (s, _) in self.held.items() if s == session_id
        ]

    def bonus_refs(self, user_id: str, kind: str) -> set[str]:
        return {r for u, _, k, r, _ in self.bonus if u == user_id and k == kind}

    def completed_session_count(self, user_id: str) -> int:
        return sum(
            1
            for s in self.sessions.values()
            if s.state.user_id == user_id
            and s.state.exit is not None
            and s.state.exit.value in ("completed", "mastery_satisfied")
        )

    def activity_days(self, user_id: str, timezone: str) -> list[date]:
        return sorted(
            {
                a.created_at.date()
                for a in self._attempts
                if self.sessions[a.session_id].state.user_id == user_id
                and a.outcome in ("correct", "wrong")
            }
        )

    def leaderboard(self, limit: int) -> list[LeaderRow]:
        totals: dict[str, int] = {}
        for a in self._attempts:
            uid = self.sessions[a.session_id].state.user_id
            totals[uid] = totals.get(uid, 0) + a.xp
        for user, _, _, _, amount in self.bonus:
            totals[user] = totals.get(user, 0) + amount
        ranked = sorted(((u, x) for u, x in totals.items() if x > 0), key=lambda p: (-p[1], p[0]))
        return [LeaderRow(u, x) for u, x in ranked[:limit]]

    def display_names(self, user_ids) -> dict[str, str]:
        return {u: self.names.get(u, "Student") for u in user_ids}

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
