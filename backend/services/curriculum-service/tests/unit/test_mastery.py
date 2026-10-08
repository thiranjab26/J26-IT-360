"""BKT update rules and the "correct" rule."""

from __future__ import annotations

from datetime import UTC, datetime

import pytest

from app.domain.mastery import (
    DEFAULT_PARAMS,
    BktParams,
    MasteryRecord,
    Observation,
    apply,
    counts_as_correct,
    update,
)

P = BktParams(p_init=0.2, p_learn=0.1, p_guess=0.25, p_slip=0.1, version="test")
NOW = datetime(2026, 10, 8, tzinfo=UTC)


def obs(correct: bool, source: str = "practice", hints: int = 0) -> Observation:
    return Observation("prog.loops", "q1", source, "ref", correct, hints, NOW)  # type: ignore[arg-type]


def test_correct_answer_matches_the_hand_calculation() -> None:
    # posterior = 0.2*0.9 / (0.2*0.9 + 0.8*0.25) = 0.18 / 0.38
    posterior = 0.18 / 0.38
    assert update(0.2, True, P, learning=False) == pytest.approx(posterior)
    assert update(0.2, True, P, learning=True) == pytest.approx(posterior + (1 - posterior) * 0.1)


def test_wrong_answer_matches_the_hand_calculation() -> None:
    # posterior = 0.2*0.1 / (0.2*0.1 + 0.8*0.75) = 0.02 / 0.62
    assert update(0.2, False, P, learning=False) == pytest.approx(0.02 / 0.62)


def test_correct_raises_and_wrong_lowers_mastery() -> None:
    for p in (0.05, 0.3, 0.6, 0.95):
        assert update(p, True, P, learning=False) > p
        assert update(p, False, P, learning=False) < p


def test_tests_measure_without_the_learning_step() -> None:
    _, practice = apply(None, obs(True), P)
    _, pretest = apply(None, obs(True, "pretest"), P)
    _, posttest = apply(None, obs(True, "posttest"), P)
    assert pretest.score == posttest.score < practice.score


@pytest.mark.parametrize(
    ("correct", "hints", "expected"), [(True, 0, True), (True, 1, False), (False, 0, False)]
)
def test_correct_means_right_without_a_hint(correct: bool, hints: int, expected: bool) -> None:
    assert counts_as_correct(correct, hints) is expected
    assert obs(correct, hints=hints).correct is expected


def test_a_hinted_right_answer_lowers_mastery_like_a_wrong_one() -> None:
    _, hinted = apply(None, obs(True, hints=2), P)
    _, wrong = apply(None, obs(False), P)
    assert hinted.score == wrong.score


def test_apply_starts_from_the_prior_and_counts_evidence() -> None:
    before, first = apply(None, obs(True), P)
    assert before == P.p_init
    assert first.evidence_count == 1
    before, second = apply(first, obs(True), P)
    assert before == first.score
    assert second.evidence_count == 2


def test_repeated_correct_practice_reaches_mastery() -> None:
    record: MasteryRecord | None = None
    for _ in range(4):
        _, record = apply(record, obs(True), DEFAULT_PARAMS)
    assert record is not None and record.is_mastered


@pytest.mark.parametrize(
    "kwargs",
    [
        {"p_init": 0.0},
        {"p_slip": 1.0},
        {"p_guess": 0.6, "p_slip": 0.5},
    ],
)
def test_invalid_parameters_are_rejected(kwargs: dict) -> None:
    values = {"p_init": 0.2, "p_learn": 0.1, "p_guess": 0.25, "p_slip": 0.1, "version": "x"}
    with pytest.raises(ValueError):
        BktParams(**(values | kwargs))
