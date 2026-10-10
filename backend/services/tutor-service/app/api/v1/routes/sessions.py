"""Guided sessions: a student learns one concept, one step at a time.

Students only. A session belongs to the student who started it; asking for anyone
else's looks the same as asking for one that does not exist.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.orm import Session

from app.config import get_settings
from app.core.deps import CurrentUser, current_user
from app.core.errors import ApiError
from app.db.session import get_session
from app.gamification.rules import Policy
from app.models.sessions import AnswerIn, ProgressOut, SessionOut, StartIn
from app.sessions.catalog import get_course
from app.sessions.repository import SqlSessionRepository
from app.sessions.service import SessionProblem, SessionService

router = APIRouter(tags=["sessions"])

_STATUS = {
    "not_found": status.HTTP_404_NOT_FOUND,
    "conflict": status.HTTP_409_CONFLICT,
    "forbidden": status.HTTP_403_FORBIDDEN,
}


def student(caller: CurrentUser = Depends(current_user)) -> CurrentUser:
    if not caller.is_student:
        raise ApiError(
            status.HTTP_403_FORBIDDEN, "students_only", "Guided sessions are for students."
        )
    return caller


def get_service(db: Session = Depends(get_session)) -> SessionService:
    settings = get_settings()
    return SessionService(
        SqlSessionRepository(db),
        get_course,
        policy=Policy(settings.session_policy),
        enforce_unlocks=settings.enforce_unlocks,
    )


def _run(call):
    try:
        return call()
    except SessionProblem as problem:
        raise ApiError(
            _STATUS[problem.kind], problem.code, problem.message, problem.details
        ) from problem


@router.post("/sessions", response_model=SessionOut, summary="Start (or return) a session")
def start_session(
    body: StartIn,
    caller: CurrentUser = Depends(student),
    service: SessionService = Depends(get_service),
) -> SessionOut:
    return _run(lambda: service.start(str(caller.user_id), body.concept_id))


@router.get("/sessions/{session_id}", response_model=SessionOut, summary="Where a session is now")
def get_session_view(
    session_id: str,
    caller: CurrentUser = Depends(student),
    service: SessionService = Depends(get_service),
) -> SessionOut:
    return _run(lambda: service.view(str(caller.user_id), session_id))


@router.post("/sessions/{session_id}/continue", response_model=SessionOut)
def continue_session(
    session_id: str,
    caller: CurrentUser = Depends(student),
    service: SessionService = Depends(get_service),
) -> SessionOut:
    return _run(lambda: service.cont(str(caller.user_id), session_id))


@router.post("/sessions/{session_id}/answer", response_model=SessionOut)
def answer_question(
    session_id: str,
    body: AnswerIn,
    caller: CurrentUser = Depends(student),
    service: SessionService = Depends(get_service),
) -> SessionOut:
    return _run(lambda: service.answer(str(caller.user_id), session_id, body.answer))


@router.post("/sessions/{session_id}/end", response_model=SessionOut)
def end_session(
    session_id: str,
    caller: CurrentUser = Depends(student),
    service: SessionService = Depends(get_service),
) -> SessionOut:
    return _run(lambda: service.end(str(caller.user_id), session_id))


@router.post("/sessions/{session_id}/resume", response_model=SessionOut)
def resume_session(
    session_id: str,
    caller: CurrentUser = Depends(student),
    service: SessionService = Depends(get_service),
) -> SessionOut:
    return _run(lambda: service.resume(str(caller.user_id), session_id))


@router.get("/progress", response_model=ProgressOut, summary="Unlocks, mastery and XP in a module")
def get_progress(
    module_id: str = Query(default="prog"),
    caller: CurrentUser = Depends(student),
    service: SessionService = Depends(get_service),
) -> ProgressOut:
    return _run(lambda: service.progress(str(caller.user_id), module_id))
