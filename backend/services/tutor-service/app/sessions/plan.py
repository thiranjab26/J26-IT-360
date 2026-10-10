"""Turn a concept's content into a session plan. Pure logic, no database, no model.

A plan is the ordered steps a session walks through: a hook, then each part of the
explanation followed by a quick multiple-choice check, then the gating checkpoints.
Which questions go in is decided here and nowhere else, so it can be varied for the
study and tested.

The rule that matters: only questions the platform can already mark are planned
(multiple choice and predict-the-output). Explain and code questions join the plan
when their graders exist, so a session never promises a question it cannot mark.
"""

from __future__ import annotations

import math
import random
from collections.abc import Collection, Mapping, Sequence

from app.domain.questions import KIND_MCQ, KIND_PREDICT, BankEntry
from app.sessions.state_machine import CHECKPOINT, HOOK, TEACH, Step

# The kinds that gate progression, in the order a student meets them.
GATING_KINDS = (KIND_PREDICT,)


def build_plan(
    *,
    concept_id: str,
    teach_refs: Sequence[str],
    bank: Mapping[str, BankEntry],
    seen: Collection[str] = (),
    pulse_checks: int = 2,
    gating_checkpoints: int = 2,
    rng: random.Random | None = None,
) -> tuple[Step, ...]:
    """The steps for one concept.

    teach_refs  the parts of the explanation, in order (theory chunk ids).
    seen        question ids this student has already met. Unseen ones come first,
                so a second session on the same concept brings new questions.
    pulse_checks / gating_checkpoints  how many of each. Fewer is fine if the concept
                has fewer questions; the plan never repeats a question.
    """
    if not teach_refs:
        raise ValueError(f"{concept_id} has nothing to teach")

    rng = rng or random.Random()
    entries = [e for e in bank.values() if e.question.concept_id == concept_id]

    pulses = _pick(entries, KIND_MCQ, seen, pulse_checks, rng)
    gating = [
        entry
        for kind in GATING_KINDS
        for entry in _pick(entries, kind, seen, gating_checkpoints, rng)
    ][:gating_checkpoints]

    # At most one quick check per teaching part, so no two ever land in the same place.
    pulses = pulses[: len(teach_refs)]

    # Quick checks are spread evenly through the explanation rather than bunched at the
    # start: after teaching part 2 and part 4 of 5, say, not after parts 1 and 2.
    after_part = {
        math.ceil((i + 1) * len(teach_refs) / (len(pulses) + 1)) - 1: pulse
        for i, pulse in enumerate(pulses)
    }

    steps: list[Step] = [Step(HOOK, concept_id)]
    for position, ref in enumerate(teach_refs):
        steps.append(Step(TEACH, ref))
        pulse = after_part.get(position)
        if pulse is not None:
            steps.append(Step(CHECKPOINT, pulse.question.question_id, gating=False))
    steps.extend(Step(CHECKPOINT, e.question.question_id, gating=True) for e in gating)
    return tuple(steps)


def _pick(
    entries: Sequence[BankEntry],
    kind: str,
    seen: Collection[str],
    count: int,
    rng: random.Random,
) -> list[BankEntry]:
    """Up to `count` questions of a kind, unseen first, each group in random order."""
    candidates = [e for e in entries if e.question.kind == kind]
    fresh = [e for e in candidates if e.question.question_id not in seen]
    stale = [e for e in candidates if e.question.question_id in seen]
    rng.shuffle(fresh)
    rng.shuffle(stale)
    return (fresh + stale)[:count]
