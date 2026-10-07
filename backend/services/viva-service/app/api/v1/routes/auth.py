"""C4 auth routes, mounted under /api/v1/viva."""

import secrets

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import settings
from app.core.auth import capabilities, current_user, digest, issue_token, user_view
from app.db.session import get_db
from app.db.tables import User
from app.models.schemas import ParticipantIn, StaffIn

router = APIRouter()


@router.post("/auth/participant", status_code=201)
def register(body: ParticipantIn, db: Session = Depends(get_db)):
    user = User(participant_code=body.participant_code, role="participant")
    db.add(user)
    return issue_token(db, user)


@router.post("/auth/staff")
def staff_login(body: StaffIn, db: Session = Depends(get_db)):
    cfg = settings()
    keys = cfg.admin_access_keys if body.role == "admin" else cfg.evaluator_access_keys
    if not any(
        secrets.compare_digest(body.access_key, key.strip())
        for key in keys.split(",")
        if key.strip()
    ):
        raise HTTPException(401, "Invalid staff access key.")
    identity = digest(body.role + ":" + body.access_key)
    user = db.scalar(select(User).where(User.staff_identity == identity))
    if user is None:
        user = User(
            participant_code=f"{body.role}-{identity[:8]}", role=body.role, staff_identity=identity
        )
        db.add(user)
    return issue_token(db, user)


@router.get("/auth/me")
def me(user: User = Depends(current_user)):
    return {"user": user_view(user), "capabilities": capabilities(user.role)}
