"""Read-only queries over the shared `core` reference data.

P0 scaffold, owned by C1. This reads `core` tables directly, which architecture
rule 4 permits (`core` is the documented exception to view-only access). It
computes nothing: no mastery, no graph, no ordering decisions. Those are C1's
research contribution and belong in this service's own `curriculum` schema.

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
    topic_count: int
    concept_count: int


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
                   count(DISTINCT t.topic_id) AS topic_count,
                   count(DISTINCT c.concept_id) AS concept_count
              FROM core.modules m
              LEFT JOIN core.topics   t ON t.module_id = m.module_id
              LEFT JOIN core.concepts c ON c.module_id = m.module_id
             GROUP BY m.module_id, m.code, m.name, m.description, m.position
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
            topic_count=row.topic_count,
            concept_count=row.concept_count,
        )
        for row in rows
    ]


def get_module(session: Session, module_id: str) -> ModuleSummary | None:
    return next((m for m in list_modules(session) if m.module_id == module_id), None)


def list_concepts(session: Session, module_id: str) -> list[ConceptRow]:
    """Concepts of one module in seeded order, each with its prerequisite IDs."""
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
