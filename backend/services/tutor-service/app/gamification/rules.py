"""What unlocks the next concept, under the two conditions of the study. Pure logic.

Research claim 3 compares two ways of deciding when a student may move on, with
everything else held identical (the same XP, the same badges, the same screens):

    MASTERY_GATED   a concept opens when every prerequisite is mastered (the estimate
                    reaches `mastery_required`). Points play no part.
    POINTS_ONLY     a concept opens when the student has earned enough XP for how deep
                    it sits in the course. Mastery plays no part: a student can open
                    the next concept by collecting points on quick checks without ever
                    demonstrating the earlier one.

The second is the baseline, modelled on apps that treat a lesson as done on submission.
Keeping the difference down to this one function is what lets a difference in learning
gain be attributed to the unlock rule.

Each locked concept explains itself ("needs 70% in Loops, you have 45%"), because a lock
the student cannot understand is just an obstacle. That is the `unmet` list.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from enum import StrEnum


class Policy(StrEnum):
    MASTERY_GATED = "mastery_gated"
    POINTS_ONLY = "points_only"


@dataclass(frozen=True)
class UnlockRules:
    mastery_required: float = 0.70  # to open what depends on a concept
    points_per_level: int = 100  # points-only: XP needed per step of depth in the course
    early_exit_mastery: float = 0.85  # to end a session early as mastery_satisfied


@dataclass(frozen=True)
class Requirement:
    kind: str  # "mastery" or "points"
    concept_id: str | None  # the prerequisite, for a mastery requirement
    required: float
    current: float | None  # None when there is no evidence yet


@dataclass(frozen=True)
class Unlock:
    concept_id: str
    unlocked: bool
    unmet: tuple[Requirement, ...] = ()


def is_mastered(value: float | None, rules: UnlockRules = UnlockRules()) -> bool:  # noqa: B008
    return value is not None and value >= rules.mastery_required


def depth(concept_id: str, prerequisites: Mapping[str, Sequence[str]]) -> int:
    """How many steps down the prerequisite chain a concept sits. A root is 0."""
    memo: dict[str, int] = {}

    def walk(node: str, path: tuple[str, ...]) -> int:
        if node in memo:
            return memo[node]
        if node in path:
            raise ValueError(f"prerequisite cycle: {' -> '.join((*path, node))}")
        parents = prerequisites.get(node, ())
        memo[node] = 0 if not parents else 1 + max(walk(p, (*path, node)) for p in parents)
        return memo[node]

    return walk(concept_id, ())


def unlock_status(
    concept_id: str,
    *,
    prerequisites: Mapping[str, Sequence[str]],
    mastery: Mapping[str, float | None],
    total_xp: int,
    policy: Policy,
    rules: UnlockRules = UnlockRules(),  # noqa: B008
) -> Unlock:
    """Whether a concept is open to this student, and if not, exactly why."""
    if policy is Policy.MASTERY_GATED:
        unmet = tuple(
            Requirement("mastery", parent, rules.mastery_required, mastery.get(parent))
            for parent in prerequisites.get(concept_id, ())
            if not is_mastered(mastery.get(parent), rules)
        )
    else:
        needed = rules.points_per_level * depth(concept_id, prerequisites)
        unmet = (
            (Requirement("points", None, float(needed), float(total_xp)),)
            if total_xp < needed
            else ()
        )
    return Unlock(concept_id, unlocked=not unmet, unmet=unmet)


def module_status(
    concepts_in_order: Sequence[str],
    *,
    prerequisites: Mapping[str, Sequence[str]],
    mastery: Mapping[str, float | None],
    total_xp: int,
    policy: Policy,
    rules: UnlockRules = UnlockRules(),  # noqa: B008
) -> list[Unlock]:
    return [
        unlock_status(
            concept,
            prerequisites=prerequisites,
            mastery=mastery,
            total_xp=total_xp,
            policy=policy,
            rules=rules,
        )
        for concept in concepts_in_order
    ]


def next_concept(
    statuses: Sequence[Unlock],
    mastery: Mapping[str, float | None],
    rules: UnlockRules = UnlockRules(),  # noqa: B008
) -> str | None:
    """Where the student should go next: the first open concept not yet mastered."""
    for status in statuses:
        if status.unlocked and not is_mastered(mastery.get(status.concept_id), rules):
            return status.concept_id
    return None
