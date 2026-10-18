"""Live explanations against the real database, inside a transaction that is thrown away.

What only the database can show: the text a live job writes is stored with the session it was
written for and nowhere else, the shared cache stays untouched, every gate verdict is logged,
and a job that gives up stores nothing. Skipped when the database cannot be reached.
"""

from __future__ import annotations

import uuid
from pathlib import Path

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session

from app.config import get_settings
from app.llm.providers import LLMQuotaError
from app.sessions.catalog import load_course
from app.sessions.grounding import primary_only
from app.sessions.repository import SqlSessionRepository
from app.sessions.service import SessionService
from app.sessions.writer import EXPLAIN, RetryPolicy, TutorWriter
from app.verification.claims import SentenceDecomposer
from app.verification.fill import ensure_live
from app.verification.gate import FaithfulnessGate
from tests.unit.test_verification import Replies, ScriptedNLI

CONTENT = Path(__file__).resolve().parents[2] / "content"
GOOD = "A loop repeats code. The update runs last."
BAD = "The body always runs once. A loop never ends."


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


def writer(model) -> TutorWriter:
    gate = FaithfulnessGate(
        ScriptedNLI({"always": 0.0, "never": 0.0}), threshold=0.3, decomposer=SentenceDecomposer()
    )
    return TutorWriter(model, gate, policy=RetryPolicy(sleep=lambda _: None))


def a_session(db, course):
    user = str(uuid.uuid4())
    service = SessionService(
        SqlSessionRepository(db), lambda _: course, enforce_unlocks=False, live=True
    )
    session_id = service.start(user, "prog.loops").session_id
    db.commit()  # into the outer transaction (still rolled back), so closing a session keeps it
    passage = next(s.ref for s in service.repo.get(session_id).state.steps if s.kind == "teach")
    return session_id, passage


def live(db, course, model, session_id, passage):
    return ensure_live(
        writer=writer(model),
        session_factory=lambda: db,  # the test's own transaction, so nothing is kept
        course=course,
        grounding=primary_only(course, passage),
        kind=EXPLAIN,
        session_id=session_id,
        text_key=f"teach:{passage}",
    )


def test_the_text_is_stored_with_its_own_session_and_the_shared_cache_stays_empty(
    db, course
) -> None:
    session_id, passage = a_session(db, course)
    before = db.execute(text("SELECT count(*) FROM tutor.verified_explanations")).scalar()

    outcome = live(db, course, Replies(GOOD), session_id, passage)

    assert outcome.status == "built"
    saved = SqlSessionRepository(db).get_text(session_id, f"teach:{passage}")
    assert saved is not None and saved.text == GOOD
    assert saved.source == "generated" and saved.verified is True
    assert saved.sources and saved.sources[0]["kind"] == "main"
    assert db.execute(text("SELECT count(*) FROM tutor.verified_explanations")).scalar() == before


def test_every_verdict_is_logged_even_for_texts_that_were_thrown_away(db, course) -> None:
    session_id, passage = a_session(db, course)
    count = "SELECT count(*) FROM tutor.gate_events WHERE decision = :d"
    blocked_before = db.execute(text(count), {"d": "block"}).scalar()
    passed_before = db.execute(text(count), {"d": "pass"}).scalar()

    live(db, course, Replies(BAD, GOOD), session_id, passage)

    assert db.execute(text(count), {"d": "block"}).scalar() == blocked_before + 2
    assert db.execute(text(count), {"d": "pass"}).scalar() == passed_before + 2


def test_a_second_run_for_the_same_point_is_a_no_op(db, course) -> None:
    session_id, passage = a_session(db, course)
    live(db, course, Replies(GOOD), session_id, passage)
    model = Replies("never used")

    outcome = live(db, course, model, session_id, passage)

    assert outcome.status == "cached" and model.prompts == []


def test_a_job_that_gives_up_stores_nothing_so_the_click_can_show_the_course_text(
    db, course
) -> None:
    session_id, passage = a_session(db, course)

    blocked = live(db, course, Replies(BAD), session_id, passage)
    assert blocked.status == "blocked" and blocked.attempts == 3
    assert SqlSessionRepository(db).get_text(session_id, f"teach:{passage}") is None

    quota = live(db, course, Replies(LLMQuotaError("used up")), session_id, passage)
    assert quota.status == "quota"
    assert SqlSessionRepository(db).get_text(session_id, f"teach:{passage}") is None
