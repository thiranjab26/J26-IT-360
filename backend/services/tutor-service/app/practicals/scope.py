"""Is a generated practical something the course has actually taught, and is it new?

Three checks that need no running code:

    taught_scope  the skills the task needs are each checked, by the same NLI model the
                  faithfulness gate uses, against what the course teaches (this concept and
                  what it builds on). A task that needs something the course never said is
                  flagged. This shows the task stays within taught material. It does NOT show
                  the solution is correct: running it and a lecturer's review do that.
    constructs    Java features in the reference solution that the course has not introduced
                  yet at this point in its order.
    duplicate     how much the description overlaps an existing practical in the concept.

The NLI threshold is the gate's. It was measured on explanation text, not on task skills, so
the status here is a flag for the lecturer to weigh and the raw scores are kept for research.
"""

from __future__ import annotations

import re
from collections.abc import Sequence
from dataclasses import dataclass

from app.practicals.generator import material_for, prerequisite_closure
from app.retrieval.hybrid import tokens
from app.sessions.catalog import Course
from app.verification.gate import score_against
from app.verification.nli import NLIModel

# Features a beginner course introduces at a particular point. Seen in a reference solution
# before the course reaches them, they make the practical unfair.
CONSTRUCTS: tuple[tuple[str, re.Pattern[str]], ...] = (
    ("lambda or arrow syntax", re.compile(r"->")),
    ("streams", re.compile(r"\.\s*stream\s*\(")),
    ("ArrayList or List", re.compile(r"\b(?:ArrayList|List)\s*<")),
    ("HashMap or Map", re.compile(r"\b(?:HashMap|TreeMap|Map)\s*<")),
    ("HashSet or Set", re.compile(r"\b(?:HashSet|TreeSet|Set)\s*<")),
    ("generics", re.compile(r"<\s*T\s*>")),
    ("interface", re.compile(r"\binterface\b")),
    ("inheritance", re.compile(r"\b(?:extends|implements|abstract)\b")),
    ("exceptions", re.compile(r"\b(?:try|catch|throw|throws)\b")),
    ("switch", re.compile(r"\bswitch\b")),
    ("record", re.compile(r"\brecord\b")),
    ("var", re.compile(r"\bvar\s+\w+\s*=")),
    ("StringBuilder", re.compile(r"\bStringBuilder\b")),
)


@dataclass(frozen=True)
class SkillScore:
    skill: str
    p_entailment: float
    supported: bool


def taught_premises(course: Course, concept_id: str) -> list[str]:
    """What the course teaches for this concept and everything it builds on."""
    texts = material_for(course, concept_id)
    for earlier in prerequisite_closure(course, concept_id):
        texts += material_for(course, earlier, ("theory", "facts"))
    return texts


def taught_scope(
    nli: NLIModel, skills: Sequence[str], premises: Sequence[str], threshold: float
) -> tuple[dict[str, str], list[SkillScore]]:
    """The check record for `taught_scope`, and every skill's score."""
    if not skills:
        return {
            "name": "taught_scope",
            "status": "warn",
            "detail": "the draft listed no skills, so its scope could not be checked",
        }, []
    scores = score_against(nli, list(premises), list(skills), windows=True)
    rows = [
        SkillScore(skill, s.entailment, s.entailment >= threshold)
        for skill, s in zip(skills, scores, strict=True)
    ]
    missing = [r for r in rows if not r.supported]
    if not missing:
        return {"name": "taught_scope", "status": "pass", "detail": ""}, rows
    # Nearly everything unsupported means the task is about something else entirely.
    outside = len(rows) >= 3 and len(missing) / len(rows) >= 0.75
    detail = "not found in the course: " + "; ".join(
        f"{r.skill} ({r.p_entailment:.2f})" for r in missing
    )
    return {"name": "taught_scope", "status": "fail" if outside else "warn", "detail": detail}, rows


def unintroduced_constructs(course: Course, concept_id: str, reference: str) -> list[str]:
    """Features used in the solution that no material up to this concept contains."""
    position = course.order.index(concept_id) if concept_id in course.order else len(course.order)
    seen = "\n".join(
        text
        for c in course.order[: position + 1]
        for chunk_id, text in course.chunk_text.items()
        if chunk_id.partition("#")[0] == c
        and not chunk_id.partition("#")[2].startswith(("solution", "rubric"))
    )
    return [
        label
        for label, pattern in CONSTRUCTS
        if pattern.search(reference) and not pattern.search(seen)
    ]


def constructs_check(course: Course, concept_id: str, reference: str) -> dict[str, str]:
    extra = unintroduced_constructs(course, concept_id, reference)
    return {
        "name": "constructs",
        "status": "warn" if extra else "pass",
        "detail": (
            "the solution uses " + ", ".join(extra) + ", which the course has not introduced yet"
            if extra
            else ""
        ),
    }


def overlap(a: str, b: str) -> float:
    """Share of the words they have in common (Jaccard), ignoring sample blocks."""
    first, second = set(tokens(_task(a))), set(tokens(_task(b)))
    return len(first & second) / len(first | second) if first and second else 0.0


def _task(statement: str) -> str:
    return re.split(r"\n\s*Sample input", statement, maxsplit=1, flags=re.I)[0]


def duplicate_check(
    statement: str, existing: Sequence[tuple[str, str]], warn: float = 0.55, fail: float = 0.85
) -> dict[str, str]:
    """`existing` is (practical id, statement) for the concept's other practicals."""
    best_id, best = "", 0.0
    for pid, other in existing:
        score = overlap(statement, other)
        if score > best:
            best_id, best = pid, score
    if best >= fail:
        status = "fail"
    elif best >= warn:
        status = "warn"
    else:
        return {"name": "duplicate", "status": "pass", "detail": ""}
    return {
        "name": "duplicate",
        "status": status,
        "detail": f"{best:.0%} of its words match {best_id}",
    }
