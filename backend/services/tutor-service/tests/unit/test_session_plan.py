"""Building a session plan from a concept's content."""

from __future__ import annotations

import random
from pathlib import Path

import pytest

from app.content.chunker import chunk_unit
from app.content.loader import load_content
from app.domain.questions import (
    KIND_MCQ,
    KIND_PREDICT,
    AnswerKey,
    BankEntry,
    Question,
    build_question_bank,
)
from app.sessions.plan import build_plan
from app.sessions.state_machine import CHECKPOINT, HOOK, TEACH


def entry(number: int, kind: str, concept: str = "prog.loops") -> BankEntry:
    qid = f"{concept}#exercise-q{number:02d}"
    return BankEntry(
        Question(qid, concept, concept, number, 1, kind, stem="?"),
        AnswerKey(qid, kind),
    )


def bank_of(*entries: BankEntry) -> dict[str, BankEntry]:
    return {e.question.question_id: e for e in entries}


BANK = bank_of(
    entry(1, KIND_MCQ),
    entry(2, KIND_MCQ),
    entry(3, KIND_MCQ),
    entry(5, KIND_PREDICT),
    entry(6, KIND_PREDICT),
    entry(7, KIND_PREDICT),
    entry(1, KIND_MCQ, "prog.arrays"),
)
TEACH_REFS = ["t1", "t2", "t3", "t4", "t5"]


def plan(**kwargs):
    defaults = dict(concept_id="prog.loops", teach_refs=TEACH_REFS, bank=BANK, rng=random.Random(1))
    return build_plan(**{**defaults, **kwargs})


def test_a_plan_opens_with_a_hook_and_ends_with_gating_checkpoints() -> None:
    steps = plan()

    assert steps[0].kind == HOOK
    tail = [s for s in steps if s.kind == CHECKPOINT and s.gating]
    assert steps[-len(tail) :] == tuple(tail), "gating checkpoints come last"
    assert len(tail) == 2


def test_every_teaching_part_appears_in_order() -> None:
    steps = plan()

    assert [s.ref for s in steps if s.kind == TEACH] == TEACH_REFS


def test_quick_checks_are_never_gating_and_gating_checks_are_never_quick() -> None:
    steps = plan()
    by_ref = {s.ref: s for s in steps if s.kind == CHECKPOINT}

    for ref, s in by_ref.items():
        assert BANK[ref].question.kind == (KIND_PREDICT if s.gating else KIND_MCQ)


def test_quick_checks_are_spread_evenly_through_the_explanation() -> None:
    steps = plan(pulse_checks=2)
    positions = [i for i, s in enumerate(steps) if s.kind == CHECKPOINT and not s.gating]
    teach_before = [sum(1 for s in steps[:i] if s.kind == TEACH) for i in positions]

    assert teach_before == [2, 4]  # after part 2 and part 4 of 5, not bunched at the start


def test_there_is_never_more_than_one_quick_check_per_part() -> None:
    steps = plan(teach_refs=["a", "b"], pulse_checks=3)

    assert sum(1 for s in steps if s.kind == CHECKPOINT and not s.gating) <= 2


def test_a_question_is_never_planned_twice() -> None:
    refs = [s.ref for s in plan(pulse_checks=5, gating_checkpoints=5) if s.kind == CHECKPOINT]

    assert len(refs) == len(set(refs))


def test_only_the_concepts_own_questions_are_used() -> None:
    refs = {s.ref for s in plan() if s.kind == CHECKPOINT}

    assert all(BANK[r].question.concept_id == "prog.loops" for r in refs)


def test_questions_the_student_has_seen_come_last() -> None:
    seen = {"prog.loops#exercise-q01", "prog.loops#exercise-q02", "prog.loops#exercise-q05"}
    steps = plan(seen=seen, pulse_checks=1, gating_checkpoints=1)
    refs = {s.ref for s in steps if s.kind == CHECKPOINT}

    assert not refs & seen, "unseen questions are preferred while any remain"


def test_seen_questions_are_reused_when_nothing_else_is_left() -> None:
    seen = {e.question.question_id for e in BANK.values()}
    steps = plan(seen=seen, pulse_checks=1, gating_checkpoints=1)

    assert sum(1 for s in steps if s.kind == CHECKPOINT) == 2


def test_the_same_seed_gives_the_same_plan_and_a_different_one_varies() -> None:
    assert plan(rng=random.Random(5)) == plan(rng=random.Random(5))
    assert len({plan(rng=random.Random(s)) for s in range(12)}) > 1


def test_a_concept_with_nothing_to_teach_is_refused() -> None:
    with pytest.raises(ValueError, match="nothing to teach"):
        plan(teach_refs=[])


def test_a_concept_with_no_questions_still_gets_a_plan() -> None:
    steps = plan(bank={})

    assert [s.kind for s in steps] == [HOOK] + [TEACH] * 5


# ------------------------------------------------------------------ real content
def test_every_concept_in_the_course_gets_a_workable_plan() -> None:
    root = Path(__file__).resolve().parents[2] / "content"
    chunks = [c for u in load_content(root, "prog") for c in chunk_unit(u)]
    bank = build_question_bank(chunks)
    concepts = sorted({c.concept_id for c in chunks if c.concept_id})

    assert len(concepts) == 13
    for concept in concepts:
        teach = [
            c.chunk_id for c in chunks if c.concept_id == concept and c.section_type == "theory"
        ]
        steps = build_plan(concept_id=concept, teach_refs=teach, bank=bank, rng=random.Random(0))

        gating = [s for s in steps if s.kind == CHECKPOINT and s.gating]
        assert gating, f"{concept} has no gating checkpoint, so nothing could be passed"
        assert [s.ref for s in steps if s.kind == TEACH] == teach
