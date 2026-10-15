"""Practicals: write a program, run it, submit it. Students only."""

from __future__ import annotations

from fastapi import APIRouter, Depends, status
from sqlalchemy.orm import Session

from app.api.v1.routes.sessions import _run, get_service, student
from app.core.deps import CurrentUser
from app.db.session import get_session
from app.models.practicals import (
    PracticalListOut,
    PracticalOut,
    RunIn,
    RunOut,
    SubmitIn,
    SubmitOut,
)
from app.practicals.repository import SqlPracticalRepository
from app.practicals.service import PracticalService
from app.sessions.catalog import get_course
from app.sessions.factory import get_runner
from app.sessions.repository import SqlSessionRepository
from app.sessions.service import SessionService

router = APIRouter(tags=["practicals"])

MODULE = "prog"


def get_practicals(
    db: Session = Depends(get_session), sessions: SessionService = Depends(get_service)
) -> PracticalService:
    def unlocked(user_id: str) -> set[str]:
        progress = sessions.progress(user_id, MODULE)
        return {c.concept_id for c in progress.concepts if c.unlocked}

    return PracticalService(
        SqlPracticalRepository(db),
        SqlSessionRepository(db),
        get_course(MODULE),
        get_runner(),
        unlocked=unlocked,
    )


@router.get(
    "/practicals", response_model=PracticalListOut, summary="Every practical and where you stand"
)
def list_practicals(
    caller: CurrentUser = Depends(student), service: PracticalService = Depends(get_practicals)
) -> PracticalListOut:
    return _run(lambda: service.listing(str(caller.user_id)))


@router.get("/practicals/{practical_id}", response_model=PracticalOut)
def get_practical(
    practical_id: str,
    caller: CurrentUser = Depends(student),
    service: PracticalService = Depends(get_practicals),
) -> PracticalOut:
    return _run(lambda: service.detail(str(caller.user_id), practical_id))


@router.post(
    "/practicals/{practical_id}/run", response_model=RunOut, summary="Try it; nothing is scored"
)
def run_practical(
    practical_id: str,
    body: RunIn,
    caller: CurrentUser = Depends(student),
    service: PracticalService = Depends(get_practicals),
) -> RunOut:
    return _run(lambda: service.run(str(caller.user_id), practical_id, body.source, body.stdin))


@router.post(
    "/practicals/{practical_id}/submit",
    response_model=SubmitOut,
    status_code=status.HTTP_200_OK,
    summary="Run it on every test",
)
def submit_practical(
    practical_id: str,
    body: SubmitIn,
    caller: CurrentUser = Depends(student),
    service: PracticalService = Depends(get_practicals),
) -> SubmitOut:
    return _run(lambda: service.submit(str(caller.user_id), practical_id, body.source))
