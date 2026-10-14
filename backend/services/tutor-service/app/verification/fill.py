"""Prepare one explanation outside a student's request, and the queue that does it.

Generating an explanation and checking it takes a model call or two plus the NLI pass, tens
of seconds in all, and a strict gate passes only some first attempts. A student must never
wait for that. So a session shows the course text when no verified explanation exists yet,
and a `Filler` prepares one in the background; the next student (or the same one, a moment
later) gets the verified explanation from the shared cache.

`ensure_verified` is the one function that does the preparing. The `prebuild` command runs
it for every passage ahead of time, and the Filler runs it for a passage nobody prepared.
It holds no database connection while the model and the checker work, because the server
drops one that sits idle that long.
"""

from __future__ import annotations

import logging
import threading
import time
from collections.abc import Callable
from concurrent.futures import Future, ThreadPoolExecutor
from dataclasses import dataclass

from sqlalchemy.orm import Session

from app.sessions.catalog import Course
from app.sessions.gate_log import record_audits
from app.sessions.grounding import Grounding
from app.sessions.repository import CachedExplanation, SqlSessionRepository
from app.sessions.writer import HINT, TutorWriter

log = logging.getLogger("tutor.fill")


@dataclass(frozen=True)
class Outcome:
    status: str  # built | cached | blocked | failed | disabled
    attempts: int = 0


def ensure_verified(
    *,
    writer: TutorWriter,
    session_factory: Callable[[], Session],
    course: Course,
    grounding: Grounding,
    kind: str,
    force: bool = False,
) -> Outcome:
    """Make sure a verified explanation of this kind exists for this passage."""
    fingerprint = writer.cache_fingerprint(kind)
    if fingerprint is None or kind == HINT:
        return Outcome("disabled")

    with session_factory() as db:
        exists = (
            SqlSessionRepository(db).get_verified(
                grounding.passage_id, grounding.digest, fingerprint
            )
            is not None
        )
    if exists and not force:
        return Outcome("cached")

    concept_id = grounding.passage_id.partition("#")[0]
    result = writer.write(
        kind,
        concept=course.titles[concept_id],
        passage=grounding.primary,
        support=grounding.support,
    )

    with session_factory() as db:
        repo = SqlSessionRepository(db)
        output_id = record_audits(repo, result.audits, grounding.passage_id)
        made = result.generated
        if made is not None and made.verified:
            repo.put_verified(
                grounding.passage_id,
                grounding.digest,
                fingerprint,
                CachedExplanation(
                    made.text,
                    made.provider,
                    made.model,
                    output_id,
                    [s.as_json() for s in grounding.sources],
                ),
            )
        db.commit()

    made = result.generated
    if made is not None and made.verified:
        return Outcome("built", len(result.audits))
    return Outcome("blocked" if result.blocked else "failed", len(result.audits))


class Filler:
    """Prepares explanations on worker threads, each one at most once at a time.

    Two uses. When a student clicks Continue and the explanation is not prepared yet, the
    request starts the job and WAITS for it, so the student sees the finished, checked text.
    And while a student reads one part, the next is prepared ahead (`prefetch`), so by the
    time they click it is usually already there.

    It remembers jobs that ended blocked or failed for a while. Without that, every view of
    such a part would start the same expensive job again.
    """

    RETRY_AFTER = 600.0  # seconds before a blocked or failed passage is tried again

    def __init__(self, work: Callable[[str, str, str], Outcome], workers: int = 2) -> None:
        self._work = work
        self._pool = ThreadPoolExecutor(max_workers=workers, thread_name_prefix="tutor-fill")
        self._running: dict[tuple[str, str, str], Future] = {}
        self._negative: dict[tuple[str, str, str], float] = {}
        self._lock = threading.Lock()

    def start(self, kind: str, module_id: str, passage_id: str) -> Future | None:
        """Begin preparing, or join a job already running. None if it recently failed."""
        key = (kind, module_id, passage_id)
        with self._lock:
            if key in self._running:
                return self._running[key]
            if self.recently_failed(kind, module_id, passage_id):
                return None
            future = self._pool.submit(self._run, key)
            self._running[key] = future
            return future

    def prefetch(self, kind: str, module_id: str, passage_id: str) -> None:
        """Prepare ahead of need. Never waits and never raises."""
        self.start(kind, module_id, passage_id)

    def wait(self, kind: str, module_id: str, passage_id: str, timeout: float) -> bool:
        """Start (or join) the job and wait for it. True if it finished in time."""
        future = self.start(kind, module_id, passage_id)
        if future is None:
            return False
        try:
            future.result(timeout=timeout)
        except Exception:
            return False
        return True

    def recently_failed(self, kind: str, module_id: str, passage_id: str) -> bool:
        stamp = self._negative.get((kind, module_id, passage_id))
        return stamp is not None and time.monotonic() - stamp < self.RETRY_AFTER

    def _run(self, key: tuple[str, str, str]) -> Outcome | None:
        outcome: Outcome | None = None
        try:
            outcome = self._work(*key)
            if outcome is not None and outcome.status in ("blocked", "failed"):
                self._negative[key] = time.monotonic()
            else:
                self._negative.pop(key, None)
        except Exception:
            log.exception("could not prepare an explanation", extra={"passage": key[2]})
            self._negative[key] = time.monotonic()
        finally:
            with self._lock:
                self._running.pop(key, None)
        return outcome
