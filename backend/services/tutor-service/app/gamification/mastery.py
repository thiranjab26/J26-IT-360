"""A stand-in mastery estimate, behind the interface the real one will use. Pure logic.

Mastery is C1's research: it models it properly with Bayesian knowledge tracing and
publishes it as `curriculum.v_mastery`. C3 only *consumes* it. Until the integration
phase (P7) this module computes a simple estimate from C3's own checkpoint results, so
that unlocks, early exits and the study do not wait on another member's delivery.

It is deliberately modest, and it is the only part of C3 that computes anything like
mastery, so it is labelled as a stub everywhere it is selected (INTEGRATION_MODE=stub).
When C1's view is live, a `LiveMasteryProvider` replaces `StubMasteryProvider` and
nothing that consumes the `MasteryProvider` interface changes.

The estimate: an exponentially weighted average of how well each *gating* checkpoint
went, oldest to newest, so recent performance counts most. Pulse checks do not count:
they can be answered by elimination, which is exactly why they never gate anything.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Protocol

# How good a gating checkpoint was, by how many tries it took. Not passing scores 0.
SCORE_BY_ATTEMPTS = {1: 1.0, 2: 0.6, 3: 0.3}

ALPHA = 0.5  # weight of the newest result against everything before it
MIN_EVIDENCE = 2  # fewer gating results than this is not enough to say anything


class MasteryProvider(Protocol):
    def mastery(self, user_id: str, concept_id: str) -> float | None:
        """0.0 to 1.0, or None when there is not yet enough evidence."""
        ...


@dataclass(frozen=True)
class CheckpointResult:
    """The outcome of one gating checkpoint, as far as mastery is concerned."""

    passed: bool
    attempts_used: int


def checkpoint_score(result: CheckpointResult) -> float:
    if not result.passed:
        return 0.0
    return SCORE_BY_ATTEMPTS.get(max(1, result.attempts_used), SCORE_BY_ATTEMPTS[3])


def estimate(
    results: Sequence[CheckpointResult], *, min_evidence: int = MIN_EVIDENCE
) -> float | None:
    """Mastery from gating checkpoint results, oldest first. None without enough evidence."""
    if len(results) < min_evidence:
        return None
    value = checkpoint_score(results[0])
    for result in results[1:]:
        value = ALPHA * checkpoint_score(result) + (1 - ALPHA) * value
    return round(value, 4)


class StubMasteryProvider:
    """Mastery computed from C3's own recorded results, used until C1's view is live."""

    def __init__(self, results: Mapping[tuple[str, str], Sequence[CheckpointResult]]) -> None:
        # keyed by (user_id, concept_id), each list oldest first
        self._results = results

    def mastery(self, user_id: str, concept_id: str) -> float | None:
        return estimate(self._results.get((user_id, concept_id), ()))
