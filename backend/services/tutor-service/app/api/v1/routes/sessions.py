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
from app.models.sessions import (
    AnswerIn,
    HistoryOut,
    LeaderboardOut,
    ProfileOut,
    ProgressOut,
    SessionOut,
    StartIn,
)
from app.sessions.catalog import get_course
from app.sessions.factory import get_filler, get_grounder, get_writer
from app.sessions.repository import SqlSessionRepository
from app.sessions.service import SessionProblem, SessionService

router = APIRouter(tags=["sessions"])

_STATUS = {
    "not_found": status.HTTP_404_NOT_FOUND,
    "conflict": status.HTTP_409_CONFLICT,
    "forbidden": status.HTTP_403_FORBIDDEN,
    "unavailable": status.HTTP_503_SERVICE_UNAVAILABLE,
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
        writer=get_writer(),
        grounding=get_grounder(),
        filler=get_filler(),
        timezone=settings.timezone,
        live=settings.explanation_mode == "live",
        fill_wait=settings.fill_wait_seconds if settings.explanation_mode == "live" else 150.0,
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


@router.get("/sessions/{session_id}/history", response_model=HistoryOut)
def session_history(
    session_id: str,
    caller: CurrentUser = Depends(student),
    service: SessionService = Depends(get_service),
) -> HistoryOut:
    """The parts the student has already read, so they can look back. Read-only."""
    return _run(lambda: service.history(str(caller.user_id), session_id))


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


@router.get("/profile", response_model=ProfileOut, summary="Level, streak and badges")
def get_profile(
    caller: CurrentUser = Depends(student),
    service: SessionService = Depends(get_service),
) -> ProfileOut:
    return _run(lambda: service.profile(str(caller.user_id)))


@router.get("/leaderboard", response_model=LeaderboardOut, summary="Top students by XP")
def get_leaderboard(
    limit: int = Query(default=10, ge=1, le=50),
    # Anyone signed in may look: a lecturer sees the same board, with no row of their own.
    caller: CurrentUser = Depends(current_user),
    service: SessionService = Depends(get_service),
) -> LeaderboardOut:
    return _run(lambda: service.leaderboard(str(caller.user_id), limit))
