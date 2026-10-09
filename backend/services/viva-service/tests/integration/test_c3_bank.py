"""Replacing the bank with the C3 catalogue clears old data and keeps the viva working."""

from sqlalchemy import func, select

from app.db.session import SessionLocal
from app.db.tables import User, VivaSession
from app.domain.c3_bank import replace_bank
from tests.conftest import answer, auth, start


def test_replace_bank_clears_old_data_and_serves_c3_topics(client):
    learner = auth(client)
    session = start(client, learner)
    answer(client, learner, session, "LIFO: last in, first out. B is removed first.")
    admin = auth(client, "admin")
    old = client.post("/api/v1/viva/courses", headers=admin, json={"name": "Old course"})
    assert old.status_code == 201, old.text
    with SessionLocal() as db:
        removed, added = replace_bank(db)
        assert removed["viva_sessions"] == 1 and removed["participants"] == 1
        assert removed["courses"] == 1
        assert added == {"courses": 10, "materials": 10, "questions": 24}
        assert db.scalar(select(func.count()).select_from(VivaSession)) == 0
        roles = list(db.scalars(select(User.role)))
        assert roles == ["admin"]  # staff stay, so nobody is signed out
    topics = client.get("/api/v1/viva/topics").json()["items"]
    assert len(topics) == 10 and all(t["id"].startswith("c3-") for t in topics)
    assert client.get("/api/v1/viva/overview", headers=admin).status_code == 200
    student = auth(client, code="P002")
    viva = start(client, student, topic_id="c3-it2070-linear-structures")
    assert viva["current_question"]["question"].startswith("Why can an array read")
    reply = answer(
        client,
        student,
        viva,
        "Array elements are next to each other in memory, so the address is calculated "
        "directly in constant time. Inserting at the front means we shift every element, "
        "which is linear.",
    )
    assert reply.status_code == 200, reply.text
    assert reply.json()["assessment"]["coverage"] == 100


def test_update_bank_refreshes_questions_and_keeps_sessions(client):
    from app.db.tables import Bank
    from app.domain.c3_bank import update_bank

    auth(client, "admin")
    with SessionLocal() as db:
        replace_bank(db)
    student = auth(client, code="P003")
    start(client, student, topic_id="c3-it1010-basics")
    with SessionLocal() as db:
        assert update_bank(db) == {"courses": 10, "materials": 10, "questions": 0}
        item = db.get(Bank, "c3-it1010-basics-01")
        item.data = {**item.data, "question": "An older wording."}
        db.commit()
        assert update_bank(db)["questions"] == 1
        refreshed = db.get(Bank, "c3-it1010-basics-01").data
        assert refreshed["question"].startswith("What is a variable?")
        assert refreshed["version"] == 2
        assert db.scalar(select(func.count()).select_from(VivaSession)) == 1  # sessions stay
