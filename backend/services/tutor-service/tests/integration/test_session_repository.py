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
    assert ended.summary.xp_earned == 2 * 10 + 2 * 120

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
    assert progress.total_xp == 2 * 10 + 2 * 120
    assert progress.active_session_id is None
