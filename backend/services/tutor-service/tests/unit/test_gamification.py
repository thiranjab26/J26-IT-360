"""XP, the stand-in mastery estimate, and the two unlock policies of the study."""

from __future__ import annotations

from pathlib import Path

import pytest

from app.content.loader import load_content
from app.gamification.mastery import (
    CheckpointResult,
    StubMasteryProvider,
    checkpoint_score,
    estimate,
)
from app.gamification.rules import (
    Policy,
    UnlockRules,
    depth,
    is_mastered,
    module_status,
    next_concept,
)
from app.gamification.xp import XPRules, xp_for_checkpoint

# ------------------------------------------------------------------------------ XP


def test_a_gating_checkpoint_passed_cleanly_earns_the_full_amount() -> None:
    assert xp_for_checkpoint(gating=True, passed=True) == 120


def test_hints_and_extra_tries_cost_xp() -> None:
    assert xp_for_checkpoint(gating=True, passed=True, hints_used=1) == 90
    assert xp_for_checkpoint(gating=True, passed=True, attempts_used=2) == 100
    assert xp_for_checkpoint(gating=True, passed=True, attempts_used=2, hints_used=1) == 70


def test_passing_is_never_worth_nothing() -> None:
    worst = xp_for_checkpoint(gating=True, passed=True, attempts_used=3, hints_used=9)

    assert worst == XPRules().floor > 0


def test_a_checkpoint_not_passed_earns_nothing() -> None:
    assert xp_for_checkpoint(gating=True, passed=False, attempts_used=3) == 0
    assert xp_for_checkpoint(gating=False, passed=False) == 0


def test_a_pulse_check_is_a_small_flat_reward_for_a_correct_answer() -> None:
    assert xp_for_checkpoint(gating=False, passed=True) == 10
    assert xp_for_checkpoint(gating=False, passed=True, hints_used=5, attempts_used=4) == 10


def test_xp_is_never_negative() -> None:
    rules = XPRules(gating=50, hint_cost=100, floor=0)

    assert xp_for_checkpoint(gating=True, passed=True, hints_used=3, rules=rules) == 0


# ------------------------------------------------------------------------- mastery
def passed(attempts: int = 1) -> CheckpointResult:
    return CheckpointResult(True, attempts)


FAILED = CheckpointResult(False, 3)


def test_one_result_is_not_enough_to_estimate_anything() -> None:
    assert estimate([]) is None
    assert estimate([passed()]) is None


def test_two_clean_passes_are_full_mastery() -> None:
    assert estimate([passed(), passed()]) == 1.0


def test_needing_more_tries_scores_lower() -> None:
    assert checkpoint_score(passed(1)) > checkpoint_score(passed(2)) > checkpoint_score(passed(3))
    assert checkpoint_score(FAILED) == 0.0


def test_recent_results_count_more_than_old_ones() -> None:
    improving = estimate([FAILED, passed(), passed()])
    declining = estimate([passed(), passed(), FAILED])

    assert improving > declining


def test_the_estimate_stays_between_zero_and_one() -> None:
    for results in ([FAILED, FAILED], [passed(), passed()], [passed(2), FAILED, passed(3)]):
        assert 0.0 <= estimate(results) <= 1.0


def test_the_stub_provider_keeps_students_and_concepts_apart() -> None:
    provider = StubMasteryProvider(
        {
            ("ann", "prog.loops"): [passed(), passed()],
            ("bob", "prog.loops"): [FAILED, FAILED],
        }
    )

    assert provider.mastery("ann", "prog.loops") == 1.0
    assert provider.mastery("bob", "prog.loops") == 0.0
    assert provider.mastery("ann", "prog.arrays") is None
    assert provider.mastery("cy", "prog.loops") is None


# -------------------------------------------------------------------------- unlocks
GRAPH = {
    "a": [],
    "b": ["a"],
    "c": ["a", "b"],
    "d": ["c"],
}
ORDER = ["a", "b", "c", "d"]


def status(policy: Policy, mastery=None, xp: int = 0, rules: UnlockRules | None = None):
    return module_status(
        ORDER,
        prerequisites=GRAPH,
        mastery=mastery or {},
        total_xp=xp,
        policy=policy,
        rules=rules or UnlockRules(),
    )


def open_ids(statuses) -> list[str]:
    return [s.concept_id for s in statuses if s.unlocked]


def test_depth_counts_the_longest_prerequisite_chain() -> None:
    assert [depth(c, GRAPH) for c in ORDER] == [0, 1, 2, 3]


def test_a_prerequisite_cycle_is_an_error_not_an_infinite_loop() -> None:
    with pytest.raises(ValueError, match="cycle"):
        depth("x", {"x": ["y"], "y": ["x"]})


def test_mastered_means_at_or_above_the_threshold() -> None:
    assert is_mastered(0.70) and is_mastered(0.95)
    assert not is_mastered(0.69) and not is_mastered(None)


def test_with_no_progress_only_the_root_is_open_under_either_policy() -> None:
    assert open_ids(status(Policy.MASTERY_GATED)) == ["a"]
    assert open_ids(status(Policy.POINTS_ONLY)) == ["a"]


def test_mastering_a_prerequisite_opens_what_depends_on_it() -> None:
    opened = status(Policy.MASTERY_GATED, mastery={"a": 0.8})

    assert open_ids(opened) == ["a", "b"]  # c still needs b as well


def test_every_prerequisite_must_be_mastered_not_just_one() -> None:
    opened = status(Policy.MASTERY_GATED, mastery={"a": 0.9, "b": 0.5})

    assert "c" not in open_ids(opened)
    assert open_ids(status(Policy.MASTERY_GATED, mastery={"a": 0.9, "b": 0.9})) == ["a", "b", "c"]


def test_points_cannot_open_anything_under_the_mastery_gated_policy() -> None:
    assert open_ids(status(Policy.MASTERY_GATED, xp=10_000)) == ["a"]


def test_mastery_cannot_open_anything_under_the_points_only_policy() -> None:
    perfect = {c: 1.0 for c in ORDER}

    assert open_ids(status(Policy.POINTS_ONLY, mastery=perfect, xp=0)) == ["a"]


def test_points_alone_open_the_course_under_the_points_only_policy() -> None:
    assert open_ids(status(Policy.POINTS_ONLY, xp=100)) == ["a", "b"]
    assert open_ids(status(Policy.POINTS_ONLY, xp=200)) == ["a", "b", "c"]
    assert open_ids(status(Policy.POINTS_ONLY, xp=300)) == ORDER


def test_a_locked_concept_says_exactly_what_is_missing() -> None:
    locked = status(Policy.MASTERY_GATED, mastery={"a": 0.45})[1]

    assert not locked.unlocked
    (need,) = locked.unmet
    assert (need.kind, need.concept_id, need.required, need.current) == ("mastery", "a", 0.70, 0.45)


def test_a_locked_concept_with_no_evidence_reports_none_not_zero() -> None:
    (need,) = status(Policy.MASTERY_GATED)[1].unmet

    assert need.current is None


def test_points_requirements_report_what_is_needed_and_what_is_held() -> None:
    (need,) = status(Policy.POINTS_ONLY, xp=40)[2].unmet

    assert (need.kind, need.required, need.current) == ("points", 200.0, 40.0)


def test_the_thresholds_are_configurable() -> None:
    strict = UnlockRules(mastery_required=0.9)

    assert open_ids(status(Policy.MASTERY_GATED, mastery={"a": 0.8}, rules=strict)) == ["a"]


def test_next_concept_is_the_first_open_one_not_yet_mastered() -> None:
    assert next_concept(status(Policy.MASTERY_GATED), {}) == "a"

    mastery = {"a": 0.9}
    assert next_concept(status(Policy.MASTERY_GATED, mastery=mastery), mastery) == "b"


def test_next_concept_is_none_when_everything_is_mastered_or_locked() -> None:
    mastery = {c: 0.9 for c in ORDER}

    assert next_concept(status(Policy.MASTERY_GATED, mastery=mastery), mastery) is None


def test_the_two_policies_differ_only_in_what_unlocks() -> None:
    """Same student, same points, same mastery: the policy alone decides."""
    mastery = {"a": 0.9, "b": 0.9}
    gated = open_ids(status(Policy.MASTERY_GATED, mastery=mastery, xp=0))
    points = open_ids(status(Policy.POINTS_ONLY, mastery=mastery, xp=0))

    assert gated == ["a", "b", "c"]
    assert points == ["a"]


# ------------------------------------------------------------------- real content
def real_prerequisites() -> tuple[list[str], dict[str, list[str]]]:
    root = Path(__file__).resolve().parents[2] / "content"
    units = [u for u in load_content(root, "prog") if u.concept_id]
    order = [u.concept_id for u in sorted(units, key=lambda u: u.sequence)]
    return order, {u.concept_id: list(u.all_prerequisites) for u in units}


def test_the_real_course_has_no_prerequisite_cycle_and_one_starting_point() -> None:
    order, graph = real_prerequisites()

    assert len(order) == 13
    assert [depth(c, graph) for c in order]  # raises on a cycle
    assert [c for c in order if not graph[c]] == ["prog.java_intro"]


def test_the_real_course_opens_one_concept_at_a_time_as_mastery_grows() -> None:
    order, graph = real_prerequisites()
    mastery: dict[str, float | None] = {}

    for expected_open in range(1, 6):
        statuses = module_status(
            order, prerequisites=graph, mastery=mastery, total_xp=0, policy=Policy.MASTERY_GATED
        )
        opened = open_ids(statuses)
        assert len(opened) >= expected_open
        target = next_concept(statuses, mastery)
        mastery[target] = 0.9  # the student masters whatever the tutor sent them to
        assert target in opened
