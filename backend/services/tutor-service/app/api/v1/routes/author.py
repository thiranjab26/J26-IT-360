"""Lecturers manage the practicals students see: draft, check, approve, reject, restore.

Lecturers only. Any lecturer may approve. Approving replaces the practical in that place and keeps
the old one in the database. These responses carry reference solutions and hidden tests, which is
why no student route may ever return them.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.orm import Session

from app.config import get_settings
from app.core.deps import CurrentUser, current_user
from app.core.errors import ApiError
from app.db.session import get_session
from app.llm.providers import build_provider
from app.models.authoring import (
    AuthorDetailOut,
    AuthorItemOut,
    AuthorOverviewOut,
    BulkIn,
    BulkOut,
    DraftIn,
    EditIn,
    GenerateIn,
    JobOut,
    ReviewIn,
)
from app.practicals.authoring import AuthoringService
from app.practicals.items import SqlAssessmentStore
from app.practicals.jobs import SqlJobStore, expire_if_stale, job_out, new_job
from app.practicals.repository import SqlPracticalRepository
from app.practicals.runtime import generation_available, start_job
from app.sessions.catalog import get_course
from app.sessions.factory import get_runner
from app.sessions.service import SessionProblem

router = APIRouter(prefix="/author", tags=["author"])

MODULE = "prog"

_STATUS = {
    "not_found": status.HTTP_404_NOT_FOUND,
    "conflict": status.HTTP_409_CONFLICT,
    "forbidden": status.HTTP_403_FORBIDDEN,
    "unavailable": status.HTTP_503_SERVICE_UNAVAILABLE,
    "invalid": 422,
}


def lecturer(caller: CurrentUser = Depends(current_user)) -> CurrentUser:
    if not caller.is_lecturer:
        raise ApiError(
            status.HTTP_403_FORBIDDEN, "lecturers_only", "Managing practicals is for lecturers."
        )
    return caller


def get_authoring(db: Session = Depends(get_session)) -> AuthoringService:
    return AuthoringService(
        SqlAssessmentStore(db),
        SqlPracticalRepository(db),
        get_course(MODULE),
        get_runner(),
        build_provider(get_settings()),
    )


def _run(call):
    try:
        return call()
    except SessionProblem as problem:
        raise ApiError(
            _STATUS[problem.kind], problem.code, problem.message, problem.details
        ) from problem


@router.get("/practicals", response_model=AuthorOverviewOut, summary="Current, drafts and history")
def overview(
    concept_id: str | None = Query(default=None),
    _: CurrentUser = Depends(lecturer),
    service: AuthoringService = Depends(get_authoring),
) -> AuthorOverviewOut:
    return _run(lambda: service.overview(concept_id))


@router.get("/practicals/{practical_id}", response_model=AuthorDetailOut)
def detail(
    practical_id: str,
    _: CurrentUser = Depends(lecturer),
    service: AuthoringService = Depends(get_authoring),
) -> AuthorDetailOut:
    return _run(lambda: service.detail(practical_id))


@router.post(
    "/drafts",
    response_model=AuthorItemOut,
    status_code=status.HTTP_201_CREATED,
    summary="Add a draft and check it",
)
def create_draft(
    body: DraftIn,
    caller: CurrentUser = Depends(lecturer),
    service: AuthoringService = Depends(get_authoring),
) -> AuthorItemOut:
    return _run(
        lambda: service.create_draft(
            str(caller.user_id),
            body.concept_id,
            body.statement,
            body.reference_solution,
            body.level,
            body.replaces,
            body.suggest_tests,
        )
    )


@router.post(
    "/drafts/{practical_id}/edit", response_model=AuthorItemOut, summary="Edit and re-check"
)
def edit_draft(
    practical_id: str,
    body: EditIn,
    _: CurrentUser = Depends(lecturer),
    service: AuthoringService = Depends(get_authoring),
) -> AuthorItemOut:
    return _run(
        lambda: service.edit_draft(
            practical_id,
            body.statement,
            body.reference_solution,
            body.level,
            body.suggest_tests,
        )
    )


@router.post(
    "/drafts/{practical_id}/approve",
    response_model=AuthorItemOut,
    summary="Replace the practical in this place with the draft",
)
def approve(
    practical_id: str,
    body: ReviewIn,
    caller: CurrentUser = Depends(lecturer),
    service: AuthoringService = Depends(get_authoring),
) -> AuthorItemOut:
    return _run(lambda: service.approve(str(caller.user_id), practical_id, body.note))


@router.post("/drafts/{practical_id}/reject", response_model=AuthorItemOut)
def reject(
    practical_id: str,
    body: ReviewIn,
    caller: CurrentUser = Depends(lecturer),
    service: AuthoringService = Depends(get_authoring),
) -> AuthorItemOut:
    return _run(lambda: service.reject(str(caller.user_id), practical_id, body.note))


@router.post(
    "/practicals/{practical_id}/restore",
    response_model=AuthorItemOut,
    summary="Bring a replaced practical back",
)
def restore(
    practical_id: str,
    caller: CurrentUser = Depends(lecturer),
    service: AuthoringService = Depends(get_authoring),
) -> AuthorItemOut:
    return _run(lambda: service.restore(str(caller.user_id), practical_id))


# ------------------------------------------------------------------- generating and bulk review
@router.post(
    "/generate",
    response_model=JobOut,
    status_code=status.HTTP_202_ACCEPTED,
    summary="Ask the model for draft practicals (runs in the background)",
)
def generate(
    body: GenerateIn,
    caller: CurrentUser = Depends(lecturer),
    service: AuthoringService = Depends(get_authoring),
    db: Session = Depends(get_session),
) -> JobOut:
    if not generation_available():
        raise ApiError(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "generation_unavailable",
            "Generating needs a configured model and the Java runner switched on.",
        )
    targets = _run(lambda: service.plan_targets(body.concept_id, body.count, body.replaces))
    job = new_job(body.concept_id, targets, body.hint, str(caller.user_id))
    SqlJobStore(db).create(job)
    db.commit()  # the worker reads the row, so it must be saved before it is started
    start_job(job.job_id)
    return job_out(job)


@router.get("/jobs", response_model=list[JobOut], summary="Recent generation jobs")
def recent_jobs(
    _: CurrentUser = Depends(lecturer), db: Session = Depends(get_session)
) -> list[JobOut]:
    store = SqlJobStore(db)
    return [job_out(expire_if_stale(store, j)) for j in store.recent()]


@router.get("/jobs/{job_id}", response_model=JobOut)
def get_job(
    job_id: str, _: CurrentUser = Depends(lecturer), db: Session = Depends(get_session)
) -> JobOut:
    store = SqlJobStore(db)
    job = store.get(job_id)
    if job is None:
        raise ApiError(status.HTTP_404_NOT_FOUND, "job_not_found", "No such job.")
    return job_out(expire_if_stale(store, job))


@router.post("/drafts/bulk-approve", response_model=BulkOut, summary="Approve several drafts")
def bulk_approve(
    body: BulkIn,
    caller: CurrentUser = Depends(lecturer),
    service: AuthoringService = Depends(get_authoring),
) -> BulkOut:
    return BulkOut(results=service.approve_many(str(caller.user_id), body.practical_ids, body.note))


@router.post("/drafts/bulk-reject", response_model=BulkOut, summary="Reject several drafts")
def bulk_reject(
    body: BulkIn,
    caller: CurrentUser = Depends(lecturer),
    service: AuthoringService = Depends(get_authoring),
) -> BulkOut:
    return BulkOut(results=service.reject_many(str(caller.user_id), body.practical_ids, body.note))
