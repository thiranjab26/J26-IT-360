"""What a generated explanation is built from: the main passage plus what retrieval finds.

An explanation of one part of a concept is not written from that part alone. The part is
the MAIN passage; the retriever (the same hybrid index the evaluation measured) is asked
for the course material most related to it, within the concept, and the best few passages
come along as support: a worked example, a common mistake, the quick facts. The model may
draw on all of them and the faithfulness gate accepts a claim that any of them supports.

The sources are kept with the text, so the screen can show exactly what an explanation was
built from. If retrieval is unavailable (no index on this machine) the explanation falls
back to the main passage alone rather than failing.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass

from app.retrieval.access import RetrievalMode
from app.retrieval.hybrid import BM25, tokens
from app.retrieval.retriever import Retriever
from app.sessions.catalog import Course
from app.sessions.writer import passage_hash

log = logging.getLogger("tutor.grounding")

SECTION_LABELS = {
    "theory": "Explanation",
    "example": "Example",
    "misconception": "Common mistake",
    "facts": "Quick facts",
}


@dataclass(frozen=True)
class Source:
    chunk_id: str
    label: str
    kind: str  # main | retrieved

    def as_json(self) -> dict[str, str]:
        return {"chunk_id": self.chunk_id, "label": self.label, "kind": self.kind}


@dataclass(frozen=True)
class Grounding:
    passage_id: str
    primary: str
    support: tuple[tuple[str, str], ...] = ()  # (label, text) of each retrieved passage
    sources: tuple[Source, ...] = ()

    @property
    def digest(self) -> str:
        """Identifies the exact material an explanation was built from. For a main passage
        with no support it is the passage's own hash."""
        return passage_hash(self.primary + "".join(f"\n\x00\n{text}" for _, text in self.support))

    @property
    def texts(self) -> list[str]:
        return [self.primary, *(text for _, text in self.support)]


def primary_only(course: Course, passage_id: str) -> Grounding:
    heading = course.chunk_heading.get(passage_id, passage_id)
    return Grounding(
        passage_id=passage_id,
        primary=course.chunk_text[passage_id],
        sources=(Source(passage_id, heading_tail(heading), "main"),),
    )


def closest_passage(course: Course, concept_id: str, question_id: str) -> str:
    """The explanation part of a concept that is closest to a question about it."""
    refs = course.theory[concept_id]
    stem = course.bank[question_id].question.stem
    scores = BM25([tokens(course.chunk_text[r]) for r in refs]).scores(tokens(stem))
    best = max(scores, key=scores.__getitem__) if scores else 0
    return refs[best]


def heading_tail(heading_path: str) -> str:
    return heading_path.split(" > ")[-1].strip() or heading_path


def build_grounding(
    retriever: Retriever | None, course: Course, passage_id: str, *, k: int = 3
) -> Grounding:
    """The main passage and up to `k` retrieved supporting passages from the same concept."""
    base = primary_only(course, passage_id)
    if retriever is None:
        return base

    concept_id = passage_id.partition("#")[0]
    query = f"{course.titles.get(concept_id, '')}. {base.primary[:400]}"
    try:
        found = retriever.search(
            query,
            mode=RetrievalMode.TUTORING,
            module_id=course.module_id,
            concept_ids=[concept_id],
            k=k + 3,
        )
    except Exception:  # no index on this machine, or the store is unreadable
        log.warning("retrieval unavailable; using the main passage alone", exc_info=True)
        return base

    picked = [p for p in found if p.chunk_id != passage_id][:k]
    labels = [
        f"{SECTION_LABELS.get(p.section_type, p.section_type)}: {heading_tail(p.heading_path)}"
        for p in picked
    ]
    support = tuple((label, p.text) for label, p in zip(labels, picked, strict=True))
    sources = (
        *base.sources,
        *(Source(p.chunk_id, label, "retrieved") for label, p in zip(labels, picked, strict=True)),
    )
    return Grounding(passage_id, base.primary, support, sources)
