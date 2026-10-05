"""Data model for authored course content and its chunks. No database, no FastAPI."""

from __future__ import annotations

from dataclasses import dataclass

# Section types the indexer keeps. Each is introduced in the markdown by a
# `<!-- section: <type> -->` comment, which is how the chunker knows what a block is
# and, later, which kinds of retrieval may see it.
INDEXED_SECTION_TYPES = (
    "overview",
    "objectives",
    "prerequisites",
    "theory",
    "example",
    "misconception",
    "facts",
    "exercise",
    "solution",
    "rubric",
)

# Authored, shown to students, never retrieved by the tutor. External links only.
NOT_INDEXED_SECTION_TYPES = ("further_practice",)

KNOWN_SECTION_TYPES = INDEXED_SECTION_TYPES + NOT_INDEXED_SECTION_TYPES

# What every concept file must contain. Module introductions only need `overview`.
REQUIRED_CONCEPT_SECTIONS = (
    "objectives",
    "prerequisites",
    "theory",
    "example",
    "misconception",
    "facts",
    "exercise",
    "solution",
    "rubric",
)

# The practice questions come in five levels. Levels 3 to 5 are free-form answers
# that need a rubric to grade; levels 1 and 2 have a single deterministic answer.
LEVEL_QUESTION_TYPES = {
    1: "mcq",
    2: "trace_predict",
    3: "explain",
    4: "implement",
    5: "challenge",
}
FIRST_RUBRIC_LEVEL = 3


def question_chunk_id(unit_id: str, section_type: str, number: int) -> str:
    """The ID of an exercise, solution or rubric chunk for a question number.

    One definition, because the chunker writes these IDs and the retriever looks
    them up by them. For a rubric entry that covers several questions the number is
    the first one it names.
    """
    return f"{unit_id}#{section_type}-q{number:02d}"


KIND_CONCEPT = "concept"
KIND_MODULE_INTRO = "module_introduction"


@dataclass(frozen=True)
class Section:
    """One marker-delimited block of a file."""

    section_type: str
    text: str
    # "Loops > Theory > The while Loop": where the block sits in the document.
    heading_path: str
    # The ### headings inside the block, in order.
    headings: tuple[str, ...]
    start_line: int


@dataclass(frozen=True)
class Unit:
    """One authored file: a concept, or a module introduction."""

    unit_id: str
    module_id: str
    concept_id: str | None
    kind: str
    sequence: int
    topic: str | None
    title: str
    difficulty: int | None
    prerequisites: tuple[str, ...]
    cross_module_prerequisites: tuple[str, ...]
    java_version: int | None
    version: int
    status: str
    source_path: str
    content_hash: str
    sections: tuple[Section, ...]

    @property
    def all_prerequisites(self) -> tuple[str, ...]:
        return self.prerequisites + self.cross_module_prerequisites


@dataclass(frozen=True)
class Chunk:
    """A retrievable piece of a unit."""

    chunk_id: str
    unit_id: str
    module_id: str
    concept_id: str | None
    section_type: str
    # Reading order within the unit.
    ordinal: int
    heading_path: str
    headings: tuple[str, ...]
    # Exercise, solution and rubric chunks only.
    question_nos: tuple[int, ...] | None
    level: int | None
    text: str
    word_count: int
    text_hash: str
