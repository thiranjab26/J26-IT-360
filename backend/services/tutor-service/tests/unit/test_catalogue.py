"""Grouping of concepts into topics, with no database involved."""

from __future__ import annotations

from app.domain.catalogue import ConceptRow, group_by_topic


def row(concept_id: str, topic_id: str, topic_name: str) -> ConceptRow:
    return ConceptRow(
        concept_id=concept_id,
        name=concept_id,
        description=None,
        topic_id=topic_id,
        topic_name=topic_name,
        prerequisite_ids=[],
    )


def test_topics_keep_the_order_their_first_concept_appeared_in() -> None:
    grouped = group_by_topic(
        [
            row("dsa.big_o", "dsa.complexity", "Complexity"),
            row("dsa.complexity_classes", "dsa.complexity", "Complexity"),
            row("dsa.array_costs", "dsa.linear_structures", "Linear Structures"),
        ]
    )

    assert [topic_id for topic_id, _, _ in grouped] == [
        "dsa.complexity",
        "dsa.linear_structures",
    ]
    assert [c.concept_id for c in grouped[0][2]] == ["dsa.big_o", "dsa.complexity_classes"]
    assert len(grouped[1][2]) == 1


def test_a_topic_interleaved_later_does_not_create_a_second_group() -> None:
    grouped = group_by_topic(
        [
            row("a", "t1", "One"),
            row("b", "t2", "Two"),
            row("c", "t1", "One"),
        ]
    )

    assert len(grouped) == 2
    assert [c.concept_id for c in grouped[0][2]] == ["a", "c"]


def test_topic_name_is_carried_through() -> None:
    grouped = group_by_topic([row("a", "dsa.recursion", "Recursion")])
    assert grouped[0][1] == "Recursion"


def test_no_rows_means_no_topics() -> None:
    assert group_by_topic([]) == []


def test_a_module_is_open_only_when_available() -> None:
    from app.domain.catalogue import ModuleSummary

    def module(status: str) -> ModuleSummary:
        return ModuleSummary(
            module_id="m",
            code=None,
            name="M",
            description=None,
            status=status,
            topic_count=0,
            concept_count=0,
        )

    assert module("available").is_available
    assert not module("coming_soon").is_available
