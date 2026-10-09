"""Counterbalancing, scoring, gain, snapshot validity, bank checks and the fixed order."""

from __future__ import annotations

import random
from collections import Counter

import pytest

from app.domain.assessment import (
    CELLS,
    AssessmentError,
    GainLine,
    Item,
    Paper,
    Response,
    auc,
    check_bank,
    choose_cell,
    form_for,
    gain_report,
    normalised_gain,
    open_test,
    score,
    summarise_group,
    validate_snapshot,
)
from app.domain.mastery import DEFAULT_PARAMS
from app.domain.recommend import fixed_order
from tests.unit.test_recommend import graph

CONCEPTS = ("prog.variables", "prog.loops", "prog.arrays")


def make_paper(module: str, form: str, concepts=CONCEPTS, prereq: tuple[str, ...] = ()) -> Paper:
    """Two main items per concept, answer always option 1; twins share the index."""
    other = "B" if form == "A" else "A"
    items = [
        Item(
            item_id=f"{module}-{form}-{n:02d}",
            position=n,
            concept_id=concept,
            section="main",
            stem=f"Question {n}",
            options=("w", "r", "x", "y"),
            answer_index=1,
            twin_item_id=f"{module}-{other}-{n:02d}",
        )
        for n, concept in enumerate((c for c in concepts for _ in range(2)), start=1)
    ]
    start = len(items) + 1
    items += [
        Item(f"{module}-{form}-P{n}", start + n, concept, "prereq", "Prereq", ("r", "w"), 0)
        for n, concept in enumerate(prereq)
    ]
    return Paper(f"{module}-{form}", module, form, f"{module} {form}", tuple(items))  # type: ignore[arg-type]


def test_only_the_matching_phase_opens_a_test() -> None:
    assert open_test("pretest") == "pretest"
    assert open_test("posttest") == "posttest"
    assert open_test("learning") is None
    assert open_test("closed") is None


def test_assignment_fills_the_least_used_cell() -> None:
    counts = {cell: 1 for cell in CELLS} | {("comparison", "BA"): 0}
    assert choose_cell(counts).group == "comparison"
    assert choose_cell(counts).form_order == "BA"


def test_assignment_stays_balanced_over_many_learners() -> None:
    rng = random.Random(42)
    counts: Counter[tuple[str, str]] = Counter()
    for _ in range(101):
        e = choose_cell(counts, rng.choice)
        counts[(e.group, e.form_order)] += 1
    assert max(counts.values()) - min(counts.values()) <= 1


def test_form_order_decides_which_paper_comes_first() -> None:
    assert (form_for("AB", "pretest"), form_for("AB", "posttest")) == ("A", "B")
    assert (form_for("BA", "pretest"), form_for("BA", "posttest")) == ("B", "A")


def test_the_prerequisite_section_is_only_on_the_pretest() -> None:
    paper = make_paper("dsa", "A", ("dsa.stack",), prereq=("prog.arrays",))
    assert any(i.section == "prereq" for i in paper.items_for("pretest"))
    assert all(i.section == "main" for i in paper.items_for("posttest"))


def test_scoring_counts_the_main_section_only_and_blanks_are_wrong() -> None:
    paper = make_paper("dsa", "A", ("dsa.stack",), prereq=("prog.arrays",))
    answers = {"dsa-A-01": 1, "dsa-A-02": None, "dsa-A-P0": 0}
    scored = score(paper.items, answers)
    assert (scored.main_correct, scored.main_total) == (1, 2)
    assert scored.score_pct == 50.0
    prereq = next(r for r in scored.responses if r.section == "prereq")
    assert prereq.correct


@pytest.mark.parametrize(
    ("answers", "code"), [({"other-01": 1}, "unknown_item"), ({"prog-A-01": 7}, "bad_choice")]
)
def test_scoring_rejects_answers_that_do_not_fit_the_paper(answers: dict, code: str) -> None:
    with pytest.raises(AssessmentError) as error:
        score(make_paper("prog", "A").items, answers)
    assert error.value.code == code


@pytest.mark.parametrize(
    ("pre", "post", "gain"), [(40, 70, 0.5), (50, 50, 0.0), (80, 60, -1.0), (100, 100, None)]
)
def test_normalised_gain(pre: float, post: float, gain: float | None) -> None:
    assert normalised_gain(pre, post) == (None if gain is None else pytest.approx(gain))


def responses(pattern: dict[str, list[bool]], section: str = "main") -> list[Response]:
    return [
        Response(f"{c}-{n}", c, section, 0, ok)  # type: ignore[arg-type]
        for c, results in pattern.items()
        for n, ok in enumerate(results)
    ]


def test_gain_report_per_topic_and_concept_ignores_the_prerequisite_section() -> None:
    pre = responses({"prog.variables": [True, False], "prog.loops": [False, False]})
    pre += responses({"prog.arrays": [False, False]}, section="prereq")
    post = responses({"prog.variables": [True, True], "prog.loops": [True, False]})
    topics = {"prog.variables": "prog.basics", "prog.loops": "prog.control"}

    report = gain_report(pre, post, topics)

    assert report.overall == GainLine(25.0, 75.0, pytest.approx(2 / 3))
    assert report.by_concept["prog.variables"].gain == pytest.approx(1.0)
    assert report.by_topic["prog.control"] == GainLine(0.0, 50.0, 0.5)
    assert "prog.arrays" not in report.by_concept


def test_group_summary_gives_mean_gain_and_class_gain() -> None:
    lines = [GainLine(40, 70, 0.5), GainLine(100, 100, None), GainLine(60, 80, 0.5)]
    summary = summarise_group(lines)
    assert summary.learners == 3
    assert summary.mean_gain == pytest.approx(0.5)  # the perfect pre-test is left out
    assert summary.class_gain == pytest.approx((250 / 3 - 200 / 3) / (100 - 200 / 3))
    assert summarise_group([]).mean_gain is None


def test_auc_handles_ties_and_one_class() -> None:
    assert auc([0.9, 0.8, 0.2, 0.1], [True, True, False, False]) == 1.0
    assert auc([0.1, 0.9], [True, False]) == 0.0
    assert auc([0.5, 0.5], [True, False]) == 0.5
    assert auc([0.3, 0.6], [True, True]) is None


def test_snapshot_validation() -> None:
    pairs = [("a", 0.9, True), ("a", 0.2, False), ("b", 0.6, True), ("b", 0.75, False)]
    result = validate_snapshot(pairs, DEFAULT_PARAMS)
    assert (result.answers, result.learners) == (4, 2)
    assert result.correct_rate == 0.5
    assert result.auc == pytest.approx(0.75)
    assert result.threshold_accuracy == 0.5
    assert 0 < result.brier < 0.25
    assert validate_snapshot([], DEFAULT_PARAMS).auc is None


def test_a_well_formed_bank_passes() -> None:
    papers = [make_paper("prog", "A"), make_paper("prog", "B")]
    assert check_bank(papers, CONCEPTS, main_items=6) == []


def test_bank_problems_are_reported() -> None:
    a = make_paper("prog", "A")
    b = make_paper("prog", "B", concepts=("prog.variables", "prog.loops", "prog.nothing"))
    problems = check_bank([a, b], CONCEPTS, main_items=24)
    assert any("6 main items, expected 24" in p for p in problems)
    assert any("unknown concept prog.nothing" in p for p in problems)
    assert any("cover concepts differently" in p for p in problems)
    assert any("needs exactly forms A and B" in p for p in check_bank([a], CONCEPTS, 6))


def test_fixed_order_follows_the_syllabus_without_an_explanation() -> None:
    plan = fixed_order(graph(), "prog", {"prog.variables": 0.9})
    rec = plan.recommendation
    assert rec is not None
    assert rec.next_concept_id == "prog.loops"
    assert (rec.reason, rec.explanation, rec.model_version) == (
        "fixed_order",
        None,
        "fixed-order-v1",
    )
    assert plan.locked == ()


def test_fixed_order_does_not_skip_ahead_to_a_weaker_concept() -> None:
    plan = fixed_order(graph(), "prog", {"prog.variables": 0.5, "prog.loops": 0.1})
    assert plan.recommendation is not None
    assert plan.recommendation.next_concept_id == "prog.variables"
    done = fixed_order(graph(), "prog", dict.fromkeys(CONCEPTS, 0.9))
    assert done.complete
