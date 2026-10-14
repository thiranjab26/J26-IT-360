"""The real SQL repository against the shared Neon database, inside a rolled-back transaction.

Nothing here is ever committed: each test works in a transaction that is thrown away,
so the shared database is left exactly as it was found. If the database cannot be
reached the tests are skipped rather than failed.
"""

from __future__ import annotations

import uuid
from pathlib import Path

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session

from app.config import get_settings
from app.sessions.catalog import load_course
from app.sessions.repository import SqlSessionRepository
from app.sessions.service import SessionService

CONTENT = Path(__file__).resolve().parents[2] / "content"
LOOPS = "prog.loops"


@pytest.fixture(scope="module")
def course():
    return load_course(CONTENT, "prog")


@pytest.fixture
def db():
    engine = create_engine(get_settings().database_url, pool_pre_ping=True)
    try:
        connection = engine.connect()
    except OperationalError:
        pytest.skip("the database is not reachable")
    transaction = connection.begin()
    session = Session(bind=connection, join_transaction_mode="create_savepoint")
    try:
        yield session
    finally:
        session.close()
        transaction.rollback()
        connection.close()
        engine.dispose()


def service_for(db: Session, course, **kwargs) -> SessionService:
    return SessionService(
        SqlSessionRepository(db), lambda _: course, enforce_unlocks=False, **kwargs
    )


def answer_for(course, view) -> str:
    _, key = SessionService._presented(view.session_id, course.bank[view.question.question_id])
    return key.correct_option or key.expected_output or ""


def play(service: SessionService, user: str, course, view):
    while view.phase != "ended":
        if view.phase == "checkpoint":
            view = service.answer(user, view.session_id, answer_for(course, view))
        else:
            view = service.cont(user, view.session_id)
    return view


def test_a_whole_session_round_trips_through_the_database(db, course) -> None:
    user = str(uuid.uuid4())
    service = service_for(db, course)

    started = service.start(user, LOOPS)
    ended = play(service, user, course, started)

    assert ended.summary.exit_reason == "completed"
    assert ended.summary.xp_earned == (2 * 10 + 2 * 120) + 50 + 50 + 100  # with bonuses

    # A fresh service on the same transaction sees the same thing: it was really stored.
    again = service_for(db, course).view(user, started.session_id)
    assert again.phase == "ended" and again.summary.xp_earned == ended.summary.xp_earned


def test_the_published_view_carries_gating_attempts_only(db, course) -> None:
    user = str(uuid.uuid4())
    service = service_for(db, course)
    view = service.start(user, LOOPS)
    while view.phase != "checkpoint" or view.question.gating is False:
        view = (
            service.answer(user, view.session_id, answer_for(course, view))
            if view.phase == "checkpoint"
            else service.cont(user, view.session_id)
        )
    service.answer(user, view.session_id, "E" if view.question.options else "definitely not it")
    play(service, user, course, service.view(user, view.session_id))

    rows = db.execute(
        text(
            "SELECT concept_id, item_id, correct, hints_used "
            "FROM tutor.v_attempt_outcomes WHERE user_id = :u ORDER BY attempted_at"
        ),
        {"u": user},
    ).all()

    assert rows, "gating attempts should be published"
    assert {r.concept_id for r in rows} == {LOOPS}
    gating_ids = {s.ref for s in service.repo.get(view.session_id).state.steps if s.gating}
    assert {r.item_id for r in rows} <= gating_ids, "pulse checks must not reach C1"


def test_the_database_allows_one_active_session_per_student(db, course) -> None:
    user = str(uuid.uuid4())
    repo = SqlSessionRepository(db)
    service = service_for(db, course)
    started = service.start(user, LOOPS)
    first = repo.get(started.session_id)

    from dataclasses import replace

    clone = replace(first, state=replace(first.state, session_id=str(uuid.uuid4())))

    assert repo.create(clone) is False
    # and the failed insert did not poison the transaction
    assert service.view(user, started.session_id).phase == "hook"


def test_progress_reads_mastery_and_xp_back_from_stored_attempts(db, course) -> None:
    user = str(uuid.uuid4())
    service = service_for(db, course)
    play(service, user, course, service.start(user, LOOPS))

    progress = service.progress(user, "prog")

    by_id = {c.concept_id: c for c in progress.concepts}
    assert by_id[LOOPS].mastery == 1.0
    assert progress.total_xp == (2 * 10 + 2 * 120) + 50 + 50 + 100
    assert progress.active_session_id is None


def test_gate_events_texts_and_the_shared_cache_round_trip(db, course) -> None:
    from app.sessions.repository import CachedExplanation, GateEvent, StoredText

    user = str(uuid.uuid4())
    service = service_for(db, course)
    repo = service.repo
    session_id = service.start(user, LOOPS).session_id
    output_id = str(uuid.uuid4())

    repo.add_gate_events(
        [
            GateEvent(
                output_id,
                1,
                "claim",
                "prog.loops#theory-01",
                "A loop repeats.",
                "m",
                "entailment",
                0.97,
                "pass",
                12,
            ),
            GateEvent(
                output_id,
                1,
                "claim",
                "prog.loops#theory-01",
                "Code line",
                "code-verbatim",
                None,
                None,
                "block",
                0,
            ),
        ]
    )
    stored = db.execute(
        text(
            "SELECT decision, nli_score FROM tutor.gate_events "
            "WHERE output_id = :o ORDER BY decision"
        ),
        {"o": output_id},
    ).all()
    assert [(r.decision, r.nli_score) for r in stored] == [("block", None), ("pass", 0.97)]

    repo.put_text(
        session_id, "teach:x", StoredText("words", "generated", "gemini", "m", True, output_id)
    )
    repo.put_text(session_id, "teach:x", StoredText("other", "authored"))  # first write wins
    saved = repo.get_text(session_id, "teach:x")
    assert (saved.text, saved.verified, saved.output_id) == ("words", True, output_id)

    assert repo.get_verified("p", "h", "f") is None
    repo.put_verified("p", "h", "f", CachedExplanation("shared", "gemini", "m", output_id))
    repo.put_verified("p", "h", "f", CachedExplanation("later", "gemini", "m"))
    hit = repo.get_verified("p", "h", "f")
    assert (hit.text, hit.output_id) == ("shared", output_id)
    assert repo.get_verified("p", "h2", "f") is None, "a changed passage must miss"


def test_gamification_records_round_trip_and_never_pay_twice(db, course) -> None:
    user = str(uuid.uuid4())
    service = service_for(db, course, timezone="UTC")
    repo = service.repo
    session_id = service.start(user, LOOPS).session_id

    assert repo.add_xp_event(user, session_id, "mastery", LOOPS, 100) is True
    assert repo.add_xp_event(user, session_id, "mastery", LOOPS, 100) is False, "unique per ref"
    assert repo.add_xp_event(user, session_id, "quest", "Control Flow", 150) is True
    assert repo.total_xp(user) == 250
    assert repo.bonus_refs(user, "quest") == {"Control Flow"}

    assert repo.award_badge(user, "first_steps", session_id) is True
    assert repo.award_badge(user, "first_steps", session_id) is False
    assert set(repo.badges(user)) == {"first_steps"}

    kinds = {(r.kind, r.ref) for r in repo.session_rewards(session_id)}
    assert kinds == {("mastery", LOOPS), ("quest", "Control Flow"), ("badge", "first_steps")}


def test_streak_days_leaderboard_and_names_come_back_from_the_database(db, course) -> None:
    user = str(uuid.uuid4())
    service = service_for(db, course, timezone="UTC")
    play(service, user, course, service.start(user, LOOPS))
    repo = service.repo

    assert len(repo.activity_days(user, "UTC")) == 1
    assert len(repo.activity_days(user, "Asia/Colombo")) == 1
    assert repo.completed_session_count(user) == 1

    board = repo.leaderboard(500)
    mine = next(row for row in board if row.user_id == user)
    assert mine.xp == repo.total_xp(user) and mine.xp > 0
    assert repo.display_names([user]) == {}, "a test user is not in core.users"

    profile = service.profile(user)
    assert profile.streak.current == 1 and profile.level.total_xp == mine.xp
    assert {b.id for b in profile.badges if b.earned} >= {"first_steps", "concept_master"}
