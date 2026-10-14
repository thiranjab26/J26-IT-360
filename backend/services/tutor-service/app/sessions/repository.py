"""Where sessions and their attempts are kept. The service talks to this protocol only.

`SqlSessionRepository` is the real one (tables in the `tutor` schema). Tests use an
in-memory twin, so the whole session flow is checked without a database, and a smaller
set of tests runs the SQL one against Neon inside a transaction that is rolled back.
"""

from __future__ import annotations

import uuid
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import date, datetime
from typing import Protocol

from sqlalchemy import func, select, text, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.db.tables import (
    checkpoint_attempts,
    gate_events,
    session_texts,
    sessions,
    user_badges,
    verified_explanations,
    xp_events,
)
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


@dataclass(frozen=True)
class StoredText:
    """What the tutor showed at one point of a session."""

    text: str
    source: str  # generated | authored
    provider: str | None = None
    model: str | None = None
    # True: the gate passed it. False: the gate blocked the wording, so this is the authored
    # passage. None: no gate ran.
    verified: bool | None = None
    output_id: str | None = None
    # [{chunk_id, label, kind}]: the main passage and the passages retrieved to help.
    sources: list[dict] | None = None
    # Not stored. True when an explanation is being prepared and this is the course text
    # shown meanwhile; the next view picks the explanation up.
    pending: bool = False


@dataclass(frozen=True)
class SessionReward:
    """A bonus or a badge recorded against a session, for its summary screen."""

    kind: str  # an XP event kind, or "badge"
    ref: str  # the bonus's ref, or the badge id
    amount: int  # XP; 0 for a badge


@dataclass(frozen=True)
class LeaderRow:
    user_id: str
    xp: int


@dataclass(frozen=True)
class CachedExplanation:
    """A gate-passed explanation shared by every session that needs it."""

    text: str
    provider: str
    model: str
    output_id: str | None = None
    sources: list[dict] | None = None


@dataclass(frozen=True)
class GateEvent:
    """One claim's verdict in one verification pass (a row of tutor.gate_events)."""

    output_id: str
    attempt: int
    granularity: str
    passage_id: str
    claim_text: str
    nli_model: str
    nli_label: str | None
    nli_score: float | None
    decision: str  # pass | block
    latency_ms: int


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

    def get_text(self, session_id: str, key: str) -> StoredText | None: ...

    def put_text(self, session_id: str, key: str, text: StoredText) -> None:
        """Keep the first text written for a point; a second write is ignored."""
        ...

    def session_texts(self, session_id: str) -> dict[str, StoredText]:
        """Every text shown in a session, by key."""
        ...

    def commit(self) -> None:
        """End the current transaction, so no connection or lock is held while something
        slow (a model, the checker) runs. Later calls begin a new one."""
        ...

    def add_gate_events(self, events: Sequence[GateEvent]) -> None: ...

    # ---- gamification
    def add_xp_event(
        self, user_id: str, session_id: str | None, kind: str, ref: str, amount: int
    ) -> bool:
        """Record a bonus. False, and nothing written, if this kind+ref was paid already."""
        ...

    def award_badge(self, user_id: str, badge_id: str, session_id: str | None) -> bool:
        """Give a badge. False if the student already holds it."""
        ...

    def badges(self, user_id: str) -> dict[str, datetime]: ...

    def session_rewards(self, session_id: str) -> list[SessionReward]: ...

    def bonus_refs(self, user_id: str, kind: str) -> set[str]:
        """What the student has already been paid a bonus of this kind for."""
        ...

    def completed_session_count(self, user_id: str) -> int: ...

    def activity_days(self, user_id: str, timezone: str) -> list[date]:
        """The distinct local days on which the student answered something."""
        ...

    def leaderboard(self, limit: int) -> list[LeaderRow]: ...

    def display_names(self, user_ids: Sequence[str]) -> dict[str, str]: ...

    def get_verified(
        self, passage_id: str, passage_hash: str, fingerprint: str
    ) -> CachedExplanation | None: ...

    def put_verified(
        self, passage_id: str, passage_hash: str, fingerprint: str, entry: CachedExplanation
    ) -> None:
        """Keep the first explanation stored under a key; a second write is ignored."""
        ...


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
        """Checkpoint points plus bonus XP, in one round trip."""
        uid = uuid.UUID(user_id)
        points = (
            select(func.coalesce(func.sum(checkpoint_attempts.c.xp), 0))
            .join(sessions, sessions.c.session_id == checkpoint_attempts.c.session_id)
            .where(sessions.c.user_id == uid)
            .scalar_subquery()
        )
        bonus = (
            select(func.coalesce(func.sum(xp_events.c.amount), 0))
            .where(xp_events.c.user_id == uid)
            .scalar_subquery()
        )
        return int(self.db.execute(select(points + bonus)).scalar_one())

    def add_xp_event(
        self, user_id: str, session_id: str | None, kind: str, ref: str, amount: int
    ) -> bool:
        result = self.db.execute(
            insert(xp_events)
            .values(
                user_id=uuid.UUID(user_id),
                session_id=uuid.UUID(session_id) if session_id else None,
                kind=kind,
                ref=ref,
                amount=amount,
            )
            .on_conflict_do_nothing(constraint="uq_xp_events_once")
            .returning(xp_events.c.event_id)
        )
        # RETURNING, not rowcount: the driver reports rowcount as -1 here. No row back means
        # the conflict clause skipped the insert, i.e. this bonus was paid already.
        return result.first() is not None

    def award_badge(self, user_id: str, badge_id: str, session_id: str | None) -> bool:
        result = self.db.execute(
            insert(user_badges)
            .values(
                user_id=uuid.UUID(user_id),
                badge_id=badge_id,
                session_id=uuid.UUID(session_id) if session_id else None,
            )
            .on_conflict_do_nothing()
            .returning(user_badges.c.badge_id)
        )
        return result.first() is not None

    def badges(self, user_id: str) -> dict[str, datetime]:
        rows = self.db.execute(
            select(user_badges.c.badge_id, user_badges.c.earned_at).where(
                user_badges.c.user_id == uuid.UUID(user_id)
            )
        )
        return {badge_id: earned_at for badge_id, earned_at in rows}

    def session_rewards(self, session_id: str) -> list[SessionReward]:
        sid = uuid.UUID(session_id)
        bonuses = self.db.execute(
            select(xp_events.c.kind, xp_events.c.ref, xp_events.c.amount)
            .where(xp_events.c.session_id == sid)
            .order_by(xp_events.c.created_at)
        )
        held = self.db.execute(
            select(user_badges.c.badge_id)
            .where(user_badges.c.session_id == sid)
            .order_by(user_badges.c.earned_at)
        )
        return [SessionReward(k, r, a) for k, r, a in bonuses] + [
            SessionReward("badge", b, 0) for (b,) in held
        ]

    def bonus_refs(self, user_id: str, kind: str) -> set[str]:
        rows = self.db.execute(
            select(xp_events.c.ref).where(
                xp_events.c.user_id == uuid.UUID(user_id), xp_events.c.kind == kind
            )
        )
        return {ref for (ref,) in rows}

    def completed_session_count(self, user_id: str) -> int:
        return int(
            self.db.execute(
                select(func.count())
                .select_from(sessions)
                .where(
                    sessions.c.user_id == uuid.UUID(user_id),
                    sessions.c.exit_reason.in_(("completed", "mastery_satisfied")),
                )
            ).scalar_one()
        )

    def activity_days(self, user_id: str, timezone: str) -> list[date]:
        rows = self.db.execute(
            text(
                "SELECT DISTINCT (a.created_at AT TIME ZONE :tz)::date AS day "
                "FROM tutor.checkpoint_attempts a JOIN tutor.sessions s USING (session_id) "
                "WHERE s.user_id = :uid AND a.outcome IN ('correct', 'wrong') ORDER BY day"
            ),
            {"tz": timezone, "uid": uuid.UUID(user_id)},
        )
        return [day for (day,) in rows]

    def leaderboard(self, limit: int) -> list[LeaderRow]:
        rows = self.db.execute(
            text(
                "SELECT user_id, SUM(xp) AS xp FROM ("
                " SELECT s.user_id, a.xp FROM tutor.checkpoint_attempts a"
                "  JOIN tutor.sessions s USING (session_id)"
                " UNION ALL SELECT user_id, amount FROM tutor.xp_events"
                ") t GROUP BY user_id HAVING SUM(xp) > 0 ORDER BY xp DESC, user_id LIMIT :n"
            ),
            {"n": limit},
        )
        return [LeaderRow(str(user_id), int(xp)) for user_id, xp in rows]

    def display_names(self, user_ids: Sequence[str]) -> dict[str, str]:
        if not user_ids:
            return {}
        rows = self.db.execute(
            text("SELECT user_id, full_name FROM core.users WHERE user_id = ANY(:ids)"),
            {"ids": [uuid.UUID(u) for u in user_ids]},
        )
        return {str(user_id): name for user_id, name in rows}

    def get_text(self, session_id: str, key: str) -> StoredText | None:
        row = (
            self.db.execute(
                select(session_texts).where(
                    session_texts.c.session_id == uuid.UUID(session_id), session_texts.c.key == key
                )
            )
            .mappings()
            .first()
        )
        if row is None:
            return None
        return StoredText(
            row["text"],
            row["source"],
            row["provider"],
            row["model"],
            row["verified"],
            str(row["output_id"]) if row["output_id"] else None,
            row["sources"],
        )

    def put_text(self, session_id: str, key: str, text: StoredText) -> None:
        self.db.execute(
            insert(session_texts)
            .values(
                session_id=uuid.UUID(session_id),
                key=key,
                text=text.text,
                source=text.source,
                provider=text.provider,
                model=text.model,
                verified=text.verified,
                output_id=uuid.UUID(text.output_id) if text.output_id else None,
                sources=text.sources,
            )
            .on_conflict_do_nothing()
        )

    def get_verified(
        self, passage_id: str, passage_hash: str, fingerprint: str
    ) -> CachedExplanation | None:
        row = (
            self.db.execute(
                select(verified_explanations).where(
                    verified_explanations.c.passage_id == passage_id,
                    verified_explanations.c.passage_hash == passage_hash,
                    verified_explanations.c.fingerprint == fingerprint,
                )
            )
            .mappings()
            .first()
        )
        if row is None:
            return None
        return CachedExplanation(
            row["text"],
            row["provider"],
            row["model"],
            str(row["output_id"]) if row["output_id"] else None,
            row["sources"],
        )

    def put_verified(
        self, passage_id: str, passage_hash: str, fingerprint: str, entry: CachedExplanation
    ) -> None:
        self.db.execute(
            insert(verified_explanations)
            .values(
                passage_id=passage_id,
                passage_hash=passage_hash,
                fingerprint=fingerprint,
                text=entry.text,
                provider=entry.provider,
                model=entry.model,
                output_id=uuid.UUID(entry.output_id) if entry.output_id else None,
                sources=entry.sources,
            )
            .on_conflict_do_nothing()
        )

    def session_texts(self, session_id: str) -> dict[str, StoredText]:
        rows = self.db.execute(
            select(session_texts).where(session_texts.c.session_id == uuid.UUID(session_id))
        ).mappings()
        return {
            row["key"]: StoredText(
                row["text"],
                row["source"],
                row["provider"],
                row["model"],
                row["verified"],
                str(row["output_id"]) if row["output_id"] else None,
                row["sources"],
            )
            for row in rows
        }

    def commit(self) -> None:
        self.db.commit()

    def add_gate_events(self, events: Sequence[GateEvent]) -> None:
        if not events:
            return
        self.db.execute(
            insert(gate_events),
            [
                {
                    "output_id": uuid.UUID(e.output_id),
                    "attempt": e.attempt,
                    "generation_mode": "tutoring",
                    "granularity": e.granularity,
                    "retrieval_condition": "normal",
                    "claim_text": e.claim_text,
                    "passage_ids": [e.passage_id],
                    "nli_model": e.nli_model,
                    "nli_label": e.nli_label,
                    "nli_score": e.nli_score,
                    "decision": e.decision,
                    "latency_ms": e.latency_ms,
                }
                for e in events
            ],
        )

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
