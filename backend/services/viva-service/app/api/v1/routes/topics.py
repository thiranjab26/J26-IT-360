"""C4 topics routes, mounted under /api/v1/viva."""

from collections import Counter

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.v1.routes.common import valid_topic
from app.core.auth import current_user
from app.db.repositories.materials import course_context, topic_catalog
from app.db.session import get_db
from app.db.tables import Bank, User
from app.integrations.context import TOPICS

router = APIRouter()


@router.get("/topics")
def topics(db: Session = Depends(get_db)):
    approved = Counter(db.scalars(select(Bank.topic_id).where(Bank.status == "approved")))
    return {
        "items": [
            {
                "id": id,
                "name": n,
                "course_id": c,
                "description": d,
                "question_count": approved[id],
            }
            for id, (n, c, d) in topic_catalog(db).items()
            # Built-in demo topics drop out once they have no approved questions; courses stay.
            if approved[id] or id not in TOPICS
        ]
    }


@router.get("/integrations/context")
def context(topic_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    valid_topic(topic_id)
    return course_context(db, topic_id, user.id)
