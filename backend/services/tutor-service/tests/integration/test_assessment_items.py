"""Lecturer-made practicals against the real database, inside a transaction that is thrown away.

What only the database can show: the stored columns survive a round trip, the "one approved item
per slot" rule is enforced by the database itself, and a whole approval works through the SQL
store and repository. Skipped when the database cannot be reached.
"""

from __future__ import annotations

import uuid
from pathlib import Path

import pytest
from sqlalchemy import create_engine
from sqlalchemy.exc import IntegrityError, OperationalError
from sqlalchemy.orm import Session

from app.config import get_settings
from app.practicals.authoring import AuthoringService
from app.practicals.items import Item, SqlAssessmentStore
from app.practicals.repository import SqlPracticalRepository
from app.practicals.service import PracticalService, practical_id
from app.sessions.catalog import load_course
from app.sessions.repository import SqlSessionRepository
from tests.unit.practical_support import FakeRunner

CONTENT = Path(__file__).resolve().parents[2] / "content"
LECTURER = str(uuid.uuid4())
STATEMENT = (
    "Read one word and print it back exactly as it was typed, on a line by itself.\n\n"
    "Sample input:\n```\nhi\n```\nSample output:\n```\nhi\n```\n"
)
SOLUTION = "public class Main { public static void main(String[] a) { /* echo */ } }"


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


def item(**kw) -> Item:
    base = {
        "question_id": f"prog.loops#gen-{uuid.uuid4().hex[:8]}",
        "slot_id": "prog.loops#exercise-q99",
        "concept_id": "prog.loops",
        "origin": "generated",
        "status": "draft",
        "number": 9,
        "level": 4,
        "statement": "s",
        "reference_solution": "r",
        "checks": [{"name": "compiles", "status": "pass", "detail": ""}],
        "generation": {"model": "m"},
        "created_by": LECTURER,
    }
    return Item(**(base | kw))


def test_an_item_survives_a_round_trip_through_the_database(db) -> None:
    store = SqlAssessmentStore(db)
    first = item()

    store.add(first)
    store.change(first.question_id, status="rejected", reviewed_by=LECTURER, review_note="no")

    saved = store.get(first.question_id)
    assert saved is not None
    assert (saved.status, saved.reviewed_by, saved.review_note) == ("rejected", LECTURER, "no")
    assert saved.checks == first.checks and saved.generation == {"model": "m"}
    assert saved.created_by == LECTURER and saved.created_at is not None
    assert store.get("prog.loops#gen-missing") is None


def test_the_database_allows_one_approved_item_per_slot(db) -> None:
    store = SqlAssessmentStore(db)
    a, b = item(), item()
    store.add(a)
    store.add(b)
    store.change(a.question_id, status="approved")

    with pytest.raises(IntegrityError), db.begin_nested():
        store.change(b.question_id, status="approved")

    store.change(a.question_id, status="retired")
    store.change(b.question_id, status="approved")  # fine once the first has gone
    assert store.get(b.question_id).status == "approved"


def test_a_whole_replacement_works_through_the_sql_store(db, course) -> None:
    runner = FakeRunner(lambda stdin: stdin)
    store, repo = SqlAssessmentStore(db), SqlPracticalRepository(db)
    author = AuthoringService(store, repo, course, runner)
    target = next(e for e in course.bank.values() if e.question.kind == "code")
    old_id = practical_id(target.question.question_id)
    student = str(uuid.uuid4())

    draft = author.create_draft(
        LECTURER, target.question.concept_id, STATEMENT, SOLUTION, 4, old_id, suggest_tests=False
    )
    assert draft.can_approve and draft.tests_total == 1
    author.approve(LECTURER, draft.practical_id, "ok")

    def students() -> PracticalService:  # one per request, as in production
        return PracticalService(repo, SqlSessionRepository(db), course, runner, items=store)

    listing = {p.practical_id: p for p in students().listing(student).practicals}
    assert draft.practical_id in listing and old_id not in listing
    assert len(listing) == 39

    kept = store.get(target.question.question_id)
    assert kept is not None and (kept.origin, kept.status) == ("authored", "retired")
    assert kept.statement == target.question.stem
    assert kept.replaced_by_question_id == draft.practical_id.replace("~", "#")

    result = students().submit(student, draft.practical_id, "x")
    assert result.passed and result.rewards is not None

    author.restore(LECTURER, old_id)
    again = {p.practical_id for p in students().listing(student).practicals}
    assert old_id in again and draft.practical_id not in again
