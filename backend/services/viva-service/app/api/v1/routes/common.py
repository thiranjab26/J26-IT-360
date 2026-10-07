"""Helpers shared by several C4 route modules."""

from fastapi import HTTPException

from app.db.session import SessionLocal
from app.db.tables import Course
from app.integrations.context import TOPICS


def valid_topic(topic_id):
    with SessionLocal() as db:
        exists = topic_id in TOPICS or db.get(Course, topic_id) is not None
    if not exists:
        raise HTTPException(404, "Topic not found.")
