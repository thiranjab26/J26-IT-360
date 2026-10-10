"""Check that authored content is consistent, and report every problem at once.

The loader refuses files it cannot parse. This module checks the things a parseable
file can still get wrong: a question with no solution, a prerequisite that does not
exist, a concept ID the rest of the platform has never heard of.

The two database-backed checks are optional inputs, so the structural checks still
run in a unit test or on a laptop with no connection:

    known_concepts   concept IDs in core.concepts. Content must match them exactly.
    known_edges      concept -> its prerequisite IDs in core.concept_prerequisites.
                     The CSVs are derived from the content frontmatter, so a
                     difference means one was changed without regenerating the other.
"""

from __future__ import annotations

import re
from collections import Counter
from collections.abc import Collection, Mapping
from dataclasses import dataclass

from app.content.models import (
    FIRST_RUBRIC_LEVEL,
    KIND_CONCEPT,
    KIND_MODULE_INTRO,
    REQUIRED_CONCEPT_SECTIONS,
    Chunk,
    Unit,
)
from app.domain.questions import question_errors, question_warnings

VALID_STATUSES = ("draft", "reviewed")
FILENAME_NUMBER_RE = re.compile(r"(?:^|/)(\d{2})-[^/]+\.md$")


@dataclass(frozen=True)
class Issue:
    severity: str  # "error" or "warning"
    where: str
    message: str

    def __str__(self) -> str:
        return f"{self.severity.upper():<7} {self.where}: {self.message}"


def validate(
    units: list[Unit],
    chunks_by_unit: Mapping[str, list[Chunk]],
    *,
    known_concepts: Collection[str] | None = None,
    known_edges: Mapping[str, Collection[str]] | None = None,
) -> list[Issue]:
    issues: list[Issue] = []

    def error(where: str, message: str) -> None:
        issues.append(Issue("error", where, message))

    def warning(where: str, message: str) -> None:
        issues.append(Issue("warning", where, message))

    concept_units = {u.concept_id: u for u in units if u.concept_id}
    loaded_ids = set(concept_units)

    _duplicates(units, error)

    for unit in units:
        where = unit.source_path
        chunks = chunks_by_unit.get(unit.unit_id, [])

        _file_matches_frontmatter(unit, where, error)

        if unit.status not in VALID_STATUSES:
            error(where, f"status must be one of {VALID_STATUSES}, got {unit.status!r}")

        present = {s.section_type for s in unit.sections}
        required = REQUIRED_CONCEPT_SECTIONS if unit.kind == KIND_CONCEPT else ("overview",)
        for section_type in required:
            if section_type not in present:
                error(where, f"missing required section `{section_type}`")

        ids = Counter(c.chunk_id for c in chunks)
        for chunk_id, count in ids.items():
            if count > 1:
                error(where, f"{count} chunks share the id {chunk_id}")

        if unit.kind == KIND_CONCEPT:
            _questions(unit, chunks, where, error)
            _question_bank(chunks, where, error, warning)
            _prerequisites(unit, where, loaded_ids, known_concepts, concept_units, error)

            if known_concepts is not None and unit.concept_id not in known_concepts:
                error(where, f"concept_id {unit.concept_id} is not in core.concepts")

            # Skip when the concept itself is unknown: that is already reported above.
            if known_edges is not None and (
                known_concepts is None or unit.concept_id in known_concepts
            ):
                expected = set(known_edges.get(unit.concept_id, ()))
                actual = set(unit.all_prerequisites)
                if expected != actual:
                    error(
                        where,
                        "prerequisites differ from core.concept_prerequisites "
                        f"(content only: {sorted(actual - expected) or '-'}, "
                        f"database only: {sorted(expected - actual) or '-'}). "
                        "Regenerate the seed CSV and reseed.",
                    )

    _seeded_without_content(units, known_concepts, warning)
    return issues


# ---------------------------------------------------------------------------
def _duplicates(units: list[Unit], error) -> None:  # noqa: ANN001
    seen: dict[str, str] = {}
    for unit in units:
        if unit.unit_id in seen:
            error(unit.source_path, f"unit_id {unit.unit_id} is also used by {seen[unit.unit_id]}")
        seen[unit.unit_id] = unit.source_path


def _file_matches_frontmatter(unit: Unit, where: str, error) -> None:  # noqa: ANN001
    match = FILENAME_NUMBER_RE.search(unit.source_path)
    if match and int(match.group(1)) != unit.sequence:
        error(where, f"filename number {match.group(1)} does not match sequence {unit.sequence}")

    folder = unit.source_path.split("/")[0]
    if folder != unit.module_id:
        error(where, f"file is in `{folder}/` but frontmatter says module `{unit.module_id}`")

    if unit.concept_id and not unit.concept_id.startswith(f"{unit.module_id}."):
        error(where, f"concept_id {unit.concept_id} does not start with `{unit.module_id}.`")

    if unit.kind == KIND_MODULE_INTRO and unit.sequence != 0:
        error(where, "a module introduction must have sequence 0")


def _question_bank(chunks: list[Chunk], where: str, error, warning) -> None:  # noqa: ANN001
    """Every question must turn into structured data, so sessions can use it.

    A missing solution is already reported by _questions, so it is skipped here rather
    than reported twice. What this adds: multiple choice that does not split into four
    options, an answer letter that is not readable, and level-2 questions that cannot be
    marked automatically (a warning, because the question still works, it just needs a
    model to mark it).
    """
    solutions = {n: c for c in chunks if c.section_type == "solution" for n in c.question_nos or ()}
    rubrics = {n: c for c in chunks if c.section_type == "rubric" for n in c.question_nos or ()}

    for exercise in (c for c in chunks if c.section_type == "exercise" and c.question_nos):
        number = exercise.question_nos[0]
        if number not in solutions:
            continue
        for problem in question_errors(exercise, solutions[number], rubrics.get(number)):
            error(where, problem)
        for note in question_warnings(exercise, solutions[number], rubrics.get(number)):
            warning(where, note)


def _questions(unit: Unit, chunks: list[Chunk], where: str, error) -> None:  # noqa: ANN001
    """Every question needs a solution, free-form ones need a rubric, nothing is orphaned."""
    exercises = {c.question_nos[0]: c for c in chunks if c.section_type == "exercise"}
    solutions = {c.question_nos[0] for c in chunks if c.section_type == "solution"}
    rubric_nos = {n for c in chunks if c.section_type == "rubric" for n in c.question_nos or ()}

    for chunk in chunks:
        if chunk.section_type == "rubric" and not chunk.question_nos:
            error(where, f"rubric chunk {chunk.chunk_id} names no question number")

    for number, chunk in sorted(exercises.items()):
        if number not in solutions:
            error(where, f"Q{number} has no solution")
        if chunk.level is None:
            error(where, f"Q{number} is not under a `### Level N` heading")
        elif chunk.level >= FIRST_RUBRIC_LEVEL and number not in rubric_nos:
            error(where, f"Q{number} (level {chunk.level}) has no rubric entry")

    for number in sorted(solutions - set(exercises)):
        error(where, f"solution for Q{number} has no matching question")
    for number in sorted(rubric_nos - set(exercises)):
        error(where, f"rubric for Q{number} has no matching question")


def _prerequisites(
    unit: Unit,
    where: str,
    loaded_ids: set[str],
    known_concepts: Collection[str] | None,
    concept_units: dict[str | None, Unit],
    error,  # noqa: ANN001
) -> None:
    for prerequisite in unit.all_prerequisites:
        exists = prerequisite in loaded_ids or (
            known_concepts is not None and prerequisite in known_concepts
        )
        if not exists:
            error(where, f"prerequisite {prerequisite} is not a known concept")
            continue

        # Within a module a concept may build only on ones taught earlier.
        earlier = concept_units.get(prerequisite)
        if earlier and earlier.module_id == unit.module_id and earlier.sequence >= unit.sequence:
            error(
                where,
                f"prerequisite {prerequisite} (sequence {earlier.sequence}) "
                f"is not taught before this concept (sequence {unit.sequence})",
            )


def _seeded_without_content(
    units: list[Unit],
    known_concepts: Collection[str] | None,
    warning,  # noqa: ANN001
) -> None:
    """A concept seeded for a module that has content, but with no file of its own."""
    if known_concepts is None:
        return
    modules_with_content = {u.module_id for u in units}
    have = {u.concept_id for u in units if u.concept_id}
    for concept_id in sorted(known_concepts):
        module = concept_id.split(".")[0]
        if module in modules_with_content and concept_id not in have:
            warning(concept_id, "is in core.concepts but has no content file")
