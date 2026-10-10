"""The authored course, loaded once, as the session service needs to read it.

Nothing here touches the database: units, chunks and the question bank come straight
from the Markdown files. The course is read-only at run time, so one loaded copy is
shared by every request. Edit a file and restart the service to see the change.
"""

from __future__ import annotations

from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

from app.config import get_settings
from app.content.chunker import chunk_unit
from app.content.loader import load_content
from app.domain.questions import BankEntry, build_question_bank
from app.sessions.plan import GATING_KINDS


@dataclass(frozen=True)
class Course:
    module_id: str
    order: tuple[str, ...]  # concept ids in teaching order
    titles: dict[str, str]
    prerequisites: dict[str, tuple[str, ...]]  # only concepts of this module
    theory: dict[str, tuple[str, ...]]  # concept id -> theory chunk ids, in reading order
    chunk_text: dict[str, str]
    bank: dict[str, BankEntry]

    def has_concept(self, concept_id: str) -> bool:
        return concept_id in self.titles

    def gating_count(self, concept_id: str) -> int:
        """How many questions a student can be gated on in this concept."""
        return sum(
            1
            for e in self.bank.values()
            if e.question.concept_id == concept_id and e.question.kind in GATING_KINDS
        )

    def objectives(self, concept_id: str) -> str:
        return self.chunk_text.get(f"{concept_id}#objectives-01", "")


class UnknownModule(Exception):
    pass


def load_course(content_root: Path, module_id: str) -> Course:
    if not (content_root / module_id).is_dir():
        raise UnknownModule(module_id)

    units = [u for u in load_content(content_root, module_id) if u.concept_id]
    units.sort(key=lambda u: u.sequence)
    chunks = [c for u in load_content(content_root, module_id) for c in chunk_unit(u)]

    known = {u.concept_id for u in units}
    return Course(
        module_id=module_id,
        order=tuple(u.concept_id for u in units),
        titles={u.concept_id: u.title.split(". ", 1)[-1] for u in units},
        prerequisites={
            u.concept_id: tuple(p for p in u.all_prerequisites if p in known) for u in units
        },
        theory={
            u.concept_id: tuple(
                c.chunk_id
                for c in chunks
                if c.concept_id == u.concept_id and c.section_type == "theory"
            )
            for u in units
        },
        chunk_text={c.chunk_id: c.text for c in chunks},
        bank=build_question_bank(chunks),
    )


@lru_cache(maxsize=4)
def get_course(module_id: str) -> Course:
    return load_course(get_settings().content_root, module_id)
