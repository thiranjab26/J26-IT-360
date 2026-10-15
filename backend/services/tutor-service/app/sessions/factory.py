"""Builds the process-wide tutor writer: the model chain plus the faithfulness gate.

One writer is shared by every request, so a provider that is down stays skipped and the
NLI model is loaded once, not per student.
"""

from __future__ import annotations

import logging
import threading
from collections.abc import Callable
from functools import lru_cache

from app.config import Settings, get_settings
from app.content.embedder import SentenceTransformerEmbedder
from app.content.indexer import open_store
from app.llm.providers import build_provider
from app.practicals.runner import CodeRunner, LocalJavaRunner
from app.retrieval.retriever import Retriever
from app.sessions.catalog import Course, get_course
from app.sessions.grounding import Grounding, build_grounding
from app.sessions.writer import TutorWriter
from app.verification.claims import Decomposer, LLMDecomposer, SentenceDecomposer
from app.verification.fill import Filler, Outcome, ensure_verified
from app.verification.gate import FaithfulnessGate
from app.verification.nli import DebertaNLI

log = logging.getLogger("tutor.factory")


def build_gate(settings: Settings, provider) -> tuple[FaithfulnessGate, DebertaNLI] | None:
    """The gate, or None when it is switched off or there is no model to gate."""
    if provider is None or not settings.gate_enabled:
        return None

    decomposer: Decomposer = (
        LLMDecomposer(provider)
        if settings.gate_decomposer.strip().lower() == "llm"
        else SentenceDecomposer()
    )
    nli = DebertaNLI(settings.nli_model)
    gate = FaithfulnessGate(
        nli,
        threshold=settings.gate_threshold,
        decomposer=decomposer,
        granularity=settings.gate_granularity.strip().lower(),
        windows=settings.gate_windows,
    )
    return gate, nli


def build_writer(settings: Settings) -> tuple[TutorWriter, DebertaNLI | None]:
    provider = build_provider(settings)
    built = build_gate(settings, provider)
    gate, nli = built if built else (None, None)
    kinds = {k.strip() for k in settings.gate_kinds.split(",") if k.strip()}
    writer = TutorWriter(
        provider,
        gate,
        max_regenerations=settings.gate_max_regenerations,
        gated_kinds=kinds,
    )
    return writer, nli


@lru_cache
def _built() -> tuple[TutorWriter, DebertaNLI | None]:
    return build_writer(get_settings())


def build_retriever(settings: Settings) -> Retriever | None:
    """The hybrid retriever over the local vector index, or None if it cannot be opened."""
    try:
        return Retriever(
            open_store(settings.chroma_root), SentenceTransformerEmbedder(settings.embedding_model)
        )
    except Exception:
        log.exception("the retrieval index could not be opened")
        return None


@lru_cache
def get_retriever() -> Retriever | None:
    return build_retriever(get_settings())


@lru_cache
def _grounder() -> Callable[[Course, str], Grounding]:
    """Retrieval for an explanation, remembered per passage for the life of the process
    (the course is read-only at run time, like the Course object itself)."""
    memory: dict[tuple[str, str], Grounding] = {}

    def ground(course: Course, passage_id: str) -> Grounding:
        key = (course.module_id, passage_id)
        if key not in memory:
            memory[key] = build_grounding(get_retriever(), course, passage_id)
        return memory[key]

    return ground


def get_grounder() -> Callable[[Course, str], Grounding]:
    return _grounder()


@lru_cache
def get_filler() -> Filler:
    """Prepares explanations in the background so a student never waits for one."""

    def work(kind: str, module_id: str, passage_id: str) -> Outcome:
        from app.db.session import SessionFactory

        course = get_course(module_id)
        return ensure_verified(
            writer=get_writer(),
            session_factory=SessionFactory,
            course=course,
            grounding=get_grounder()(course, passage_id),
            kind=kind,
        )

    return Filler(work)


@lru_cache
def get_runner() -> CodeRunner | None:
    """The code runner for practicals, or None when it is switched off."""
    settings = get_settings()
    if settings.practicals_runner.strip().lower() == "off":
        return None
    return LocalJavaRunner(run_timeout=settings.practicals_run_timeout)


def get_writer() -> TutorWriter:
    return _built()[0]


def preload_in_background() -> None:
    """Load the NLI weights at start-up so the first student does not wait for them."""
    nli = _built()[1]

    def load() -> None:
        # Loaded now so the first student does not pay for them: the retrieval embedder
        # (every explanation is built from retrieved passages) and the checker model.
        try:
            retriever = get_retriever()
            if retriever is not None:
                retriever._embedder.embed_query("warm up")  # noqa: SLF001
                log.info("retrieval index and embedder ready")
        except Exception:
            log.exception("could not warm the retriever")
        if nli is None:
            return
        try:
            nli.load()
            log.info("faithfulness gate model loaded", extra={"model": nli.name})
        except Exception:
            log.exception("could not load the faithfulness gate model")

    threading.Thread(target=load, name="model-preload", daemon=True).start()
