"""rules-v1 recommendations and explanations."""

from __future__ import annotations

import pytest

from app.domain.graph import Concept, Edge, GraphError, PrerequisiteGraph
from app.domain.recommend import recommend


def graph() -> PrerequisiteGraph:
    # PF: variables -> loops -> arrays;  DSA: stack (root), search needs arrays (cross-module)
    concepts = [
        Concept("prog.variables", "Variables", "prog", "prog.basics", "Basics", 1),
        Concept("prog.loops", "Loops", "prog", "prog.control", "Control", 2),
        Concept("prog.arrays", "Arrays", "prog", "prog.arrays", "Arrays", 3),
        Concept("dsa.stack", "Stacks", "dsa", "dsa.linear", "Linear", 1),
        Concept("dsa.search", "Searching", "dsa", "dsa.search", "Search", 2),
    ]
    edges = [
        Edge("prog.loops", "prog.variables", False),
        Edge("prog.arrays", "prog.loops", False),
        Edge("dsa.search", "prog.arrays", True),
        Edge("dsa.search", "dsa.stack", False),
    ]
    return PrerequisiteGraph(concepts, edges, "test")


def test_a_new_learner_starts_at_the_first_concept() -> None:
    plan = recommend(graph(), "prog", {})
    rec = plan.recommendation
    assert rec is not None
    assert rec.next_concept_id == "prog.variables"
    assert rec.readiness == 1.0
    assert rec.explanation == "Variables has no prerequisites, so it is a good place to start."
    assert rec.model_version == "rules-v1"
    assert rec.reason == "adaptive"


def test_the_ready_concept_is_explained_by_its_mastered_prerequisites() -> None:
    plan = recommend(graph(), "prog", {"prog.variables": 0.9, "prog.loops": 0.4})
    rec = plan.recommendation
    assert rec is not None
    assert rec.next_concept_id == "prog.loops"
    assert rec.readiness == pytest.approx(0.9)
    assert rec.explanation == "You are ready for Loops because you have mastered Variables."


def test_locked_concepts_name_their_weakest_prerequisite() -> None:
    plan = recommend(graph(), "prog", {"prog.variables": 0.9, "prog.loops": 0.4})
    locked = {lock.concept_id: lock for lock in plan.locked}
    assert set(locked) == {"prog.arrays"}
    assert locked["prog.arrays"].weak_prerequisite_id == "prog.loops"
    assert locked["prog.arrays"].weak_prerequisite_mastery == pytest.approx(0.4)


def test_among_ready_concepts_the_lowest_mastery_comes_first() -> None:
    mastery = {"prog.arrays": 0.8, "dsa.stack": 0.5}
    plan = recommend(graph(), "dsa", mastery | {"prog.variables": 0.9, "prog.loops": 0.9})
    assert plan.recommendation is not None
    assert plan.recommendation.next_concept_id == "dsa.stack"


def test_dsa_blocked_by_pf_reinforces_the_pf_prerequisite_first() -> None:
    mastery = {"dsa.stack": 0.9, "prog.variables": 0.9, "prog.loops": 0.3}
    rec = recommend(graph(), "dsa", mastery).recommendation
    assert rec is not None
    assert rec.target_concept_id == "dsa.search"
    assert rec.weak_prerequisite_id == "prog.arrays"
    # Arrays itself waits on Loops, so the walk goes down to Loops.
    assert rec.next_concept_id == "prog.loops"
    assert rec.next_topic_id == "prog.control"
    assert (
        rec.explanation == "Strengthen Loops first (30% mastered), because Searching builds on it."
    )


def test_a_prerequisite_without_evidence_is_called_not_started() -> None:
    mastery = {"dsa.stack": 0.9, "prog.variables": 0.9, "prog.loops": 0.9}
    rec = recommend(graph(), "dsa", mastery).recommendation
    assert rec is not None
    assert rec.explanation == (
        "Strengthen Arrays first (not started yet), because Searching builds on it."
    )


def test_a_mastered_module_is_complete() -> None:
    mastery = {"prog.variables": 0.9, "prog.loops": 0.8, "prog.arrays": 0.75}
    plan = recommend(graph(), "prog", mastery)
    assert plan.complete
    assert plan.recommendation is None
    assert plan.locked == ()


def test_the_threshold_is_inclusive() -> None:
    plan = recommend(graph(), "prog", {"prog.variables": 0.70})
    assert plan.recommendation is not None
    assert plan.recommendation.next_concept_id == "prog.loops"


def test_explanations_are_one_sentence_without_dashes() -> None:
    cases = [{}, {"prog.variables": 0.9}, {"dsa.stack": 0.9, "prog.variables": 0.9}]
    for module in ("prog", "dsa"):
        for mastery in cases:
            rec = recommend(graph(), module, mastery).recommendation
            assert rec is not None
            assert rec.explanation.count(".") == 1 and rec.explanation.endswith(".")
            assert "—" not in rec.explanation


def test_an_unknown_module_raises() -> None:
    with pytest.raises(GraphError):
        recommend(graph(), "physics", {})
