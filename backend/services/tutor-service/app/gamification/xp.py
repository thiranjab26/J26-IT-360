"""Experience points, awarded per checkpoint passed. Pure logic.

XP is a reward, not a measure of learning, and in the study it is deliberately the same
in both conditions (mastery-gated and points-only). Only what XP is allowed to *unlock*
differs between them (see rules.py), so a difference in learning gain can be attributed
to the unlock rule and not to a difference in how generous the points were.

Rules, from the session design:

    XP is earned for each checkpoint passed, not for finishing a session.
    A gating checkpoint is worth the most. Each hint costs XP, and so does each extra
    try, but passing is never worth nothing: it is always at least `floor`.
    A pulse check (multiple choice) is a small flat reward for answering correctly.
    A checkpoint that was not passed earns nothing.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class XPRules:
    gating: int = 120  # a gating checkpoint passed first time, with no hints
    pulse: int = 10  # a pulse check answered correctly
    hint_cost: int = 30  # per hint used on a gating checkpoint
    retry_cost: int = 20  # per try after the first on a gating checkpoint
    floor: int = 20  # passing a gating checkpoint always earns at least this


def xp_for_checkpoint(
    *,
    gating: bool,
    passed: bool,
    attempts_used: int = 1,
    hints_used: int = 0,
    rules: XPRules = XPRules(),  # noqa: B008 (frozen, so sharing the default is safe)
) -> int:
    """XP for one checkpoint. Never negative, and zero unless it was passed."""
    if not passed:
        return 0
    if not gating:
        return rules.pulse

    earned = (
        rules.gating
        - rules.hint_cost * max(0, hints_used)
        - rules.retry_cost * max(0, attempts_used - 1)
    )
    return max(rules.floor, earned)
