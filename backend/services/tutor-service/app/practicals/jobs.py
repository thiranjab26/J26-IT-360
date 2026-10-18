"""A lecturer's request for a batch of draft practicals, run in the background.

One draft takes tens of seconds (the model writes it, its solution is run, the course is
consulted), so a request becomes a JOB the lecturer can watch. The job makes one draft per
target, one at a time, saving each as soon as it is ready so a lecturer can start reviewing
while the rest are still coming.

The worker never holds a database connection while it waits for the model: each step opens its
own short session through `scope`, because a connection left idle for a minute is dropped by the
database.

No FastAPI imports.
"""

from __future__ import annotations

import logging
import time
import uuid
from collections.abc import Callable
from contextlib import AbstractContextManager
from dataclasses import dataclass, field, replace
from datetime import UTC, datetime, timedelta
from typing import Any, Protocol

from sqlalchemy import insert, select, update
from sqlalchemy.orm import Session

from app.db.tables import assessment_jobs
from app.llm.providers import LLMError
from app.models.authoring import JobOut
from app.practicals.authoring import AuthoringService
from app.practicals.generation import DraftGenerator, ProposalError

log = logging.getLogger("tutor.practicals.jobs")

QUEUED, RUNNING, FINISHED, FAILED = "queued", "running", "finished", "failed"
STALE_AFTER = timedelta(minutes=45)


@dataclass(frozen=True)
class Job:
    job_id: str
    concept_id: str
    requested: int
    status: str
    targets: list[str]
    hint: str | None = None
    done: int = 0
    failed: int = 0
    item_ids: list[str] = field(default_factory=list)
    message: str | None = None
    created_by: str | None = None
    created_at: datetime | None = None
    finished_at: datetime | None = None


def new_job(concept_id: str, targets: list[str], hint: str | None, created_by: str | None) -> Job:
    return Job(
        job_id=str(uuid.uuid4()),
        concept_id=concept_id,
        requested=len(targets),
        status=QUEUED,
        targets=targets,
        hint=hint,
        created_by=created_by,
    )


class JobStore(Protocol):
    def create(self, job: Job) -> None: ...

    def get(self, job_id: str) -> Job | None: ...

    def recent(self, limit: int = 10) -> list[Job]: ...

    def change(self, job_id: str, **fields: Any) -> None: ...


class SqlJobStore:
    def __init__(self, db: Session) -> None:
        self.db = db

    def create(self, job: Job) -> None:
        self.db.execute(
            insert(assessment_jobs).values(
                job_id=uuid.UUID(job.job_id),
                concept_id=job.concept_id,
                requested=job.requested,
                status=job.status,
                hint=job.hint,
                targets=job.targets,
                item_ids=job.item_ids,
                created_by=uuid.UUID(job.created_by) if job.created_by else None,
            )
        )

    def get(self, job_id: str) -> Job | None:
        try:
            key = uuid.UUID(job_id)
        except ValueError:
            return None
        row = (
            self.db.execute(select(assessment_jobs).where(assessment_jobs.c.job_id == key))
            .mappings()
            .first()
        )
        return self._job(row) if row else None

    def recent(self, limit: int = 10) -> list[Job]:
        rows = self.db.execute(
            select(assessment_jobs).order_by(assessment_jobs.c.created_at.desc()).limit(limit)
        ).mappings()
        return [self._job(r) for r in rows]

    def change(self, job_id: str, **fields: Any) -> None:
        self.db.execute(
            update(assessment_jobs)
            .where(assessment_jobs.c.job_id == uuid.UUID(job_id))
            .values(**fields)
        )

    @staticmethod
    def _job(row) -> Job:
        return Job(
            job_id=str(row["job_id"]),
            concept_id=row["concept_id"],
            requested=row["requested"],
            status=row["status"],
            targets=list(row["targets"]),
            hint=row["hint"],
            done=row["done"],
            failed=row["failed"],
            item_ids=list(row["item_ids"]),
            message=row["message"],
            created_by=str(row["created_by"]) if row["created_by"] else None,
            created_at=row["created_at"],
            finished_at=row["finished_at"],
        )


def expire_if_stale(store: JobStore, job: Job, now: datetime | None = None) -> Job:
    """A job still 'running' long after it started was lost (the service restarted): say so."""
    now = now or datetime.now(UTC)
    if job.status in (QUEUED, RUNNING) and job.created_at and now - job.created_at > STALE_AFTER:
        message = "This was interrupted, probably by a restart. Start it again."
        store.change(job.job_id, status=FAILED, message=message, finished_at=now)
        return replace(job, status=FAILED, message=message, finished_at=now)
    return job


def job_out(job: Job) -> JobOut:
    return JobOut(
        job_id=job.job_id,
        concept_id=job.concept_id,
        status=job.status,  # type: ignore[arg-type]
        requested=job.requested,
        done=job.done,
        failed=job.failed,
        hint=job.hint,
        draft_ids=job.item_ids,
        message=job.message,
        created_at=job.created_at,
        finished_at=job.finished_at,
    )


Scope = Callable[[], AbstractContextManager[tuple[AuthoringService, JobStore]]]


class JobRunner:
    def __init__(
        self, scope: Scope, make_generator: Callable[[], DraftGenerator], pause: float = 2.0
    ) -> None:
        self.scope = scope
        self.make_generator = make_generator
        self.pause = pause  # a breath between drafts, for a rate-limited model

    def run(self, job_id: str) -> None:
        with self.scope() as (_, jobs):
            job = jobs.get(job_id)
            if job is None or job.status != QUEUED:
                return
            jobs.change(job_id, status=RUNNING)

        try:
            generator = self.make_generator()
        except Exception as exc:
            log.exception("practical generation could not start")
            self._finish(job_id, FAILED, 0, 0, [], f"Generation is not available: {exc}")
            return

        done, failed, made = 0, 0, []
        message: str | None = None
        for number, target in enumerate(job.targets, 1):
            try:
                with self.scope() as (author, _):
                    plan = author.prepare_generation(job.concept_id, target)
                draft = generator.generate(job.concept_id, plan.level, plan.existing, job.hint, [])
                with self.scope() as (author, _):
                    saved = author.save_generated(job.created_by, plan, draft, job_id)
                made.append(saved.practical_id)
                done += 1
            except LLMError:
                # Out of quota or no network: the rest would fail the same way.
                failed += len(job.targets) - done - failed
                message = "The model could not be reached (the daily quota may be used up)."
                log.warning("practical generation stopped: model unavailable", exc_info=True)
                break
            except ProposalError:
                failed += 1
                message = "The model's reply could not be used for at least one draft."
            except Exception:
                failed += 1
                message = "One draft failed unexpectedly. The others were kept."
                log.exception("practical generation failed for %s", target)
            self._progress(job_id, done, failed, made)
            if number < len(job.targets):
                time.sleep(self.pause)

        status = FINISHED if done > 0 else FAILED
        self._finish(job_id, status, done, failed, made, message)

    # ---------------------------------------------------------------- helpers
    def _progress(self, job_id: str, done: int, failed: int, made: list[str]) -> None:
        with self.scope() as (_, jobs):
            jobs.change(job_id, done=done, failed=failed, item_ids=list(made))

    def _finish(
        self, job_id: str, status: str, done: int, failed: int, made: list[str], message: str | None
    ) -> None:
        with self.scope() as (_, jobs):
            jobs.change(
                job_id,
                status=status,
                done=done,
                failed=failed,
                item_ids=list(made),
                message=message,
                finished_at=datetime.now(UTC),
            )
