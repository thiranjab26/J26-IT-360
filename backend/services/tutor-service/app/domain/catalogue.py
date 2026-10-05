"""What a learner can study: modules, topics and the concepts inside them.

This reads the shared `core` tables directly, which architecture rule 4 permits
(`core` is the documented exception to view-only access). It is the learner
catalogue that the tutor dashboard and, later, the quest map are built on.

What this deliberately does not do: compute mastery, decide unlock order, or
derive prerequisite structure. Mastery belongs to C1 and is consumed from
`curriculum.v_mastery` from phase P7. Until then a concept here carries the
seeded prerequisite IDs and nothing about the learner's progress.

No FastAPI imports in this layer.
"""

from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy import text
from sqlalchemy.orm import Session


@dataclass(frozen=True)
class ModuleSummary:
    module_id: str
    code: str | None
    name: str
    description: str | None
    status: str  # "available" or "coming_soon"
    topic_count: int
    concept_count: int

    @property
    def is_available(self) -> bool:
        return self.status == "available"


@dataclass(frozen=True)
class ConceptRow:
    concept_id: str
    name: str
    description: str | None
    topic_id: str
    topic_name: str
    prerequisite_ids: list[str]


def list_modules(session: Session) -> list[ModuleSummary]:
    rows = session.execute(
        text(
            """
            SELECT m.module_id,
                   m.code,
                   m.name,
                   m.description,
                   m.status,
                   count(DISTINCT t.topic_id) AS topic_count,
                   count(DISTINCT c.concept_id) AS concept_count
              FROM core.modules m
              LEFT JOIN core.topics   t ON t.module_id = m.module_id
              LEFT JOIN core.concepts c ON c.module_id = m.module_id
             GROUP BY m.module_id, m.code, m.name, m.description, m.status, m.position
             ORDER BY m.position, m.module_id
            """
        )
    ).all()

    return [
        ModuleSummary(
            module_id=row.module_id,
            code=row.code,
            name=row.name,
            description=row.description,
            status=row.status,
            topic_count=row.topic_count,
            concept_count=row.concept_count,
        )
        for row in rows
    ]


def get_module(session: Session, module_id: str) -> ModuleSummary | None:
    return next((m for m in list_modules(session) if m.module_id == module_id), None)


def list_concepts(session: Session, module_id: str) -> list[ConceptRow]:
    """Concepts of one module in seeded teaching order, with prerequisite IDs."""
    rows = session.execute(
        text(
            """
            SELECT c.concept_id,
                   c.name,
                   c.description,
                   c.topic_id,
                   t.name AS topic_name,
                   coalesce(
                       array_agg(p.prerequisite_id ORDER BY p.prerequisite_id)
                           FILTER (WHERE p.prerequisite_id IS NOT NULL),
                       '{}'
                   ) AS prerequisite_ids
              FROM core.concepts c
              JOIN core.topics t ON t.topic_id = c.topic_id
              LEFT JOIN core.concept_prerequisites p ON p.concept_id = c.concept_id
             WHERE c.module_id = :module_id
             GROUP BY c.concept_id, c.name, c.description, c.topic_id, t.name,
                      t.position, c.position
             ORDER BY t.position, c.position
            """
        ),
        {"module_id": module_id},
    ).all()

    return [
        ConceptRow(
            concept_id=row.concept_id,
            name=row.name,
            description=row.description,
            topic_id=row.topic_id,
            topic_name=row.topic_name,
            prerequisite_ids=list(row.prerequisite_ids),
        )
        for row in rows
    ]


def group_by_topic(rows: list[ConceptRow]) -> list[tuple[str, str, list[ConceptRow]]]:
    """Group concepts into (topic_id, topic_name, concepts).

    Topics come out in the order their first concept appeared, which preserves
    the teaching order the query produced.
    """
    order: list[str] = []
    grouped: dict[str, tuple[str, list[ConceptRow]]] = {}

    for row in rows:
        if row.topic_id not in grouped:
            order.append(row.topic_id)
            grouped[row.topic_id] = (row.topic_name, [])
        grouped[row.topic_id][1].append(row)

    return [(topic_id, grouped[topic_id][0], grouped[topic_id][1]) for topic_id in order]
