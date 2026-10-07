"""The prerequisite graph refuses invalid structures and answers graph questions."""

from __future__ import annotations

import pytest

from app.domain.graph import Concept, Edge, GraphError, PrerequisiteGraph


def concept(cid: str, position: int = 0) -> Concept:
    module = cid.split(".")[0]
    return Concept(cid, cid.title(), module, f"{module}.topic", "Topic", position)


def graph(edges: list[tuple[str, str]], extra: tuple[str, ...] = ()) -> PrerequisiteGraph:
    """edges are (prerequisite, concept): the first must be learned before the second."""
    ids = sorted({c for pair in edges for c in pair} | set(extra))
    return PrerequisiteGraph(
        [concept(cid, i) for i, cid in enumerate(ids)],
        [Edge(c, p, p.split(".")[0] != c.split(".")[0]) for p, c in edges],
        "test",
    )


# A slice of the real PF + DSA graph.
REAL = [
    ("prog.methods", "prog.call_flow"),
    ("prog.call_flow", "dsa.call_stack"),
    ("dsa.stack", "dsa.call_stack"),
    ("dsa.call_stack", "dsa.recursion_cases"),
    ("prog.methods", "dsa.recursion_cases"),
]


def test_prerequisites_and_dependents() -> None:
    g = graph(REAL)
    assert g.prerequisites_of("dsa.recursion_cases") == ("dsa.call_stack", "prog.methods")
    assert g.dependents_of("prog.methods") == ("dsa.recursion_cases", "prog.call_flow")
    assert g.prerequisites_of("dsa.stack") == ()


def test_depth_is_the_longest_prerequisite_chain() -> None:
    g = graph(REAL)
    assert g.depth("prog.methods") == 0
    assert g.depth("prog.call_flow") == 1
    assert g.depth("dsa.call_stack") == 2
    # Two routes lead here (via call_stack, depth 2, and directly from methods);
    # depth follows the longer one.
    assert g.depth("dsa.recursion_cases") == 3


def test_concepts_come_in_learning_order() -> None:
    g = graph(REAL)
    order = [c.concept_id for c in g.concepts]
    for prerequisite, dependent in REAL:
        assert order.index(prerequisite) < order.index(dependent)


def test_a_cycle_is_rejected_with_the_cycle_named() -> None:
    with pytest.raises(GraphError, match="cycle") as caught:
        graph([("dsa.a", "dsa.b"), ("dsa.b", "dsa.c"), ("dsa.c", "dsa.a")])
    message = str(caught.value)
    for cid in ("dsa.a", "dsa.b", "dsa.c"):
        assert cid in message


def test_a_self_loop_is_rejected() -> None:
    with pytest.raises(GraphError, match="own prerequisite"):
        graph([("dsa.a", "dsa.a")])


def test_an_edge_to_an_unknown_concept_is_rejected() -> None:
    with pytest.raises(GraphError, match="unknown concept"):
        PrerequisiteGraph([concept("dsa.a")], [Edge("dsa.a", "dsa.missing", False)], "test")


def test_duplicate_concepts_are_rejected() -> None:
    with pytest.raises(GraphError, match="Duplicate"):
        PrerequisiteGraph([concept("dsa.a"), concept("dsa.a")], [], "test")


def test_duplicate_edges_are_merged() -> None:
    g = graph([("dsa.a", "dsa.b"), ("dsa.a", "dsa.b")])
    assert len(g.edges) == 1


def test_module_view_keeps_cross_module_prerequisites() -> None:
    dsa = graph(REAL).for_module("dsa")
    ids = {c.concept_id for c in dsa.concepts}
    # PF concepts that DSA directly builds on stay visible...
    assert {"prog.call_flow", "prog.methods"} <= ids
    # ...and every edge in the view ends at a DSA concept.
    assert all(e.concept_id.startswith("dsa.") for e in dsa.edges)


def test_unknown_module_is_an_error() -> None:
    with pytest.raises(GraphError, match="Unknown module"):
        graph(REAL).for_module("physics")


def test_checksum_changes_only_when_structure_changes() -> None:
    assert graph(REAL).checksum() == graph(list(reversed(REAL))).checksum()
    assert graph(REAL).checksum() != graph(REAL[:-1]).checksum()


def test_isolated_concepts_are_kept() -> None:
    g = graph(REAL, extra=("dsa.queue",))
    assert "dsa.queue" in g
    assert g.depth("dsa.queue") == 0
