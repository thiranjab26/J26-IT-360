"""Wiring for generation jobs: one background worker, and a short database session per step.

One worker thread, so a lecturer's second request waits for the first. The claim-checking model
and the Java runner are not meant to be hammered by several drafts at once, and the model's daily
quota is the real limit anyway.
"""

from __future__ import annotations

from collections.abc import Iterator
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from functools import lru_cache

from app.config import get_settings
from app.db.session import SessionFactory
from app.llm.providers import build_provider
from app.practicals.authoring import AuthoringService
from app.practicals.generation import DraftGenerator
from app.practicals.items import SqlAssessmentStore
from app.practicals.jobs import JobRunner, JobStore, SqlJobStore
from app.practicals.repository import SqlPracticalRepository
from app.sessions.catalog import get_course
from app.sessions.factory import get_nli, get_runner

MODULE = "prog"


class GenerationUnavailable(Exception):
    """No model or no code runner is configured, so nothing can be generated."""


@contextmanager
def sql_scope() -> Iterator[tuple[AuthoringService, JobStore]]:
    """A fresh session that commits when the step succeeds and is closed straight after."""
    db = SessionFactory()
    try:
        yield (
            AuthoringService(
                SqlAssessmentStore(db),
                SqlPracticalRepository(db),
                get_course(MODULE),
                get_runner(),
            ),
            SqlJobStore(db),
        )
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def make_generator() -> DraftGenerator:
    settings = get_settings()
    runner, provider = get_runner(), build_provider(settings)
    if runner is None or provider is None:
        raise GenerationUnavailable("it needs a configured model and the Java runner switched on")
    return DraftGenerator(get_course(MODULE), runner, provider, get_nli(), settings.gate_threshold)


def generation_available() -> bool:
    return get_runner() is not None and build_provider(get_settings()) is not None


@lru_cache
def get_job_runner() -> JobRunner:
    return JobRunner(sql_scope, make_generator)


@lru_cache
def _executor() -> ThreadPoolExecutor:
    return ThreadPoolExecutor(max_workers=1, thread_name_prefix="practical-generation")


def start_job(job_id: str) -> None:
    """Hand a saved job to the worker. The job row must already be committed."""
    _executor().submit(get_job_runner().run, job_id)
