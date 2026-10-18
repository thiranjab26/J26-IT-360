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
from app.sessions.repository import CachedExplanation, SqlSessionRepository, StoredText
from app.sessions.writer import HINT, TutorWriter

log = logging.getLogger("tutor.fill")


@dataclass(frozen=True)
class Outcome:
    status: str  # built | cached | blocked | failed | quota | disabled
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
    if result.reason == "quota":
        return Outcome("quota", len(result.audits))
    return Outcome("blocked" if result.blocked else "failed", len(result.audits))


def ensure_live(
    *,
    writer: TutorWriter,
    session_factory: Callable[[], Session],
    course: Course,
    grounding: Grounding,
    kind: str,
    session_id: str,
    text_key: str,
) -> Outcome:
    """Write this explanation for ONE session and keep it with that session only.

    Live mode. Nothing is read from or written to the shared cache, so one student never gets
    text written for another. The result is stored as the session's own text for this point,
    which is where the click picks it up. If the writer gives up (the gate kept rejecting, the
    model kept failing, or the quota is gone) nothing is stored here: the click shows the
    authored course text and says which kind of failure it was.

    Like `ensure_verified` it holds no database connection while the model and checker work.
    """
    if writer.cache_fingerprint(kind) is None:
        return Outcome("disabled")

    with session_factory() as db:
        if SqlSessionRepository(db).get_text(session_id, text_key) is not None:
            return Outcome("cached")  # already written, for example by an earlier prefetch

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
            repo.put_text(
                session_id,
                text_key,
                StoredText(
                    made.text,
                    "generated",
                    made.provider,
                    made.model,
                    True,
                    output_id,
                    [s.as_json() for s in grounding.sources],
                ),
            )
        db.commit()

    made = result.generated
    if made is not None and made.verified:
        return Outcome("built", len(result.audits))
    if result.reason == "quota":
        return Outcome("quota", len(result.audits))
    return Outcome("blocked" if result.blocked else "failed", len(result.audits))


class Filler:
    """Prepares explanations on worker threads, each one at most once at a time.

    Two uses. When a student clicks Continue and the explanation is not prepared yet, the
    request starts the job and WAITS for it, so the student sees the finished, checked text.
    And while a student reads one part, the next is prepared ahead (`prefetch`), so by the
    time they click it is usually already there.

    A job is identified by what it makes. In cached mode that is a passage, shared by every
    student. In live mode it is a passage for one session (`scope`: the session and the text
    key), so two students never share a job or its result.

    It remembers jobs that ended badly for a while, because without that every view of such a
    part would start the same expensive job again. The memory is per passage, whoever asked, and
    how long it lasts depends on why the job failed: a passage the gate keeps rejecting is left
    alone longest, a model that could not be reached only briefly.
    """

    RETRY_AFTER = 600.0  # seconds before a blocked or failed passage is tried again

    def __init__(
        self,
        work: Callable[..., Outcome],
        workers: int = 2,
        *,
        blocked_memory: float = RETRY_AFTER,
        failed_memory: float = RETRY_AFTER,
        quota_memory: float = RETRY_AFTER,
    ) -> None:
        self._work = work
        self._pool = ThreadPoolExecutor(max_workers=workers, thread_name_prefix="tutor-fill")
        self._running: dict[tuple[str, ...], Future] = {}
        # (kind, module, passage) -> (when it failed, how long to remember, why)
        self._negative: dict[tuple[str, str, str], tuple[float, float, str]] = {}
        self._memory = {
            "blocked": blocked_memory,
            "failed": failed_memory,
            "quota": quota_memory,
        }
        self._lock = threading.Lock()

    def start(
        self,
        kind: str,
        module_id: str,
        passage_id: str,
        scope: tuple[str, str] | None = None,
    ) -> Future | None:
        """Begin preparing, or join a job already running. None if it recently failed."""
        key = (kind, module_id, passage_id, *(scope or ()))
        with self._lock:
            if key in self._running:
                return self._running[key]
            if self.recently_failed(kind, module_id, passage_id):
                return None
            future = self._pool.submit(self._run, key)
            self._running[key] = future
            return future

    def prefetch(
        self,
        kind: str,
        module_id: str,
        passage_id: str,
        scope: tuple[str, str] | None = None,
    ) -> None:
        """Prepare ahead of need. Never waits and never raises."""
        self.start(kind, module_id, passage_id, scope)

    def wait(
        self,
        kind: str,
        module_id: str,
        passage_id: str,
        timeout: float,
        scope: tuple[str, str] | None = None,
    ) -> bool:
        """Start (or join) the job and wait for it. True if it finished in time."""
        future = self.start(kind, module_id, passage_id, scope)
        if future is None:
            return False
        try:
            future.result(timeout=timeout)
        except Exception:
            return False
        return True

    def recently_failed(self, kind: str, module_id: str, passage_id: str) -> bool:
        return self.failure_reason(kind, module_id, passage_id) is not None

    def failure_reason(self, kind: str, module_id: str, passage_id: str) -> str | None:
        """Why a passage recently failed (blocked, failed or quota), or None if it did not."""
        entry = self._negative.get((kind, module_id, passage_id))
        if entry is not None and time.monotonic() - entry[0] < entry[1]:
            return entry[2]
        return None

    def _run(self, key: tuple[str, ...]) -> Outcome | None:
        passage_key = (key[0], key[1], key[2])
        outcome: Outcome | None = None
        try:
            outcome = self._work(*key)
            if outcome is not None and outcome.status in self._memory:
                self._negative[passage_key] = (
                    time.monotonic(),
                    self._memory[outcome.status],
                    outcome.status,
                )
            else:
                self._negative.pop(passage_key, None)
        except Exception:
            log.exception("could not prepare an explanation", extra={"passage": key[2]})
            self._negative[passage_key] = (time.monotonic(), self._memory["failed"], "failed")
        finally:
            with self._lock:
                self._running.pop(key, None)
        return outcome
