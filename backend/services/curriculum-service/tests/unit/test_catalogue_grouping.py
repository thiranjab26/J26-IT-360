"""The grouping logic in the catalogue route, with no database involved."""

from __future__ import annotations

from app.domain.catalogue import ConceptRow
from app.models.catalogue import ConceptOut, TopicOut


def group(rows: list[ConceptRow]) -> list[TopicOut]:
    """Mirror of the grouping in routes/catalogue.py, exercised directly."""
    topics: list[TopicOut] = []
    index: dict[str, TopicOut] = {}
    for row in rows:
        topic = index.get(row.topic_id)
        if topic is None:
            topic = TopicOut(topic_id=row.topic_id, name=row.topic_name, concepts=[])
            index[row.topic_id] = topic
            topics.append(topic)
        topic.concepts.append(
            ConceptOut(
                concept_id=row.concept_id,
                name=row.name,
                description=row.description,
                topic_id=row.topic_id,
                topic_name=row.topic_name,
                prerequisite_ids=row.prerequisite_ids,
            )
        )
    return topics


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
    topics = group(
        [
            row("dsa.big_o", "dsa.complexity", "Complexity"),
            row("dsa.complexity_classes", "dsa.complexity", "Complexity"),
            row("dsa.array_costs", "dsa.linear_structures", "Linear Structures"),
        ]
    )

    assert [t.topic_id for t in topics] == ["dsa.complexity", "dsa.linear_structures"]
    assert [c.concept_id for c in topics[0].concepts] == ["dsa.big_o", "dsa.complexity_classes"]
    assert len(topics[1].concepts) == 1


def test_a_topic_interleaved_later_does_not_create_a_second_group() -> None:
    topics = group(
        [
            row("a", "t1", "One"),
            row("b", "t2", "Two"),
            row("c", "t1", "One"),
        ]
    )

    assert len(topics) == 2
    assert [c.concept_id for c in topics[0].concepts] == ["a", "c"]


def test_no_rows_means_no_topics() -> None:
    assert group([]) == []
