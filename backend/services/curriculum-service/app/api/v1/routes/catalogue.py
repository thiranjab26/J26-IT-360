"""Module and concept catalogue.

P0 scaffold so the student dashboard has something real to render. Read only.
C1 owns this service and will replace these routes with the adaptive engine;
nothing here computes mastery or ordering.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, status
from sqlalchemy.orm import Session

from app.core.errors import ApiError
from app.db.session import get_session
from app.domain import catalogue
from app.models.catalogue import ConceptOut, ModuleConceptsOut, ModuleOut, TopicOut

router = APIRouter(tags=["catalogue"])


@router.get(
    "/modules",
    response_model=list[ModuleOut],
    summary="Every module a student can study",
)
def list_modules(session: Session = Depends(get_session)) -> list[ModuleOut]:
    return [
        ModuleOut(
            module_id=module.module_id,
            code=module.code,
            name=module.name,
            description=module.description,
            topic_count=module.topic_count,
            concept_count=module.concept_count,
        )
        for module in catalogue.list_modules(session)
    ]


@router.get(
    "/modules/{module_id}/concepts",
    response_model=ModuleConceptsOut,
    summary="Concepts of one module, grouped by topic in teaching order",
)
def list_module_concepts(
    module_id: str,
    session: Session = Depends(get_session),
) -> ModuleConceptsOut:
    module = catalogue.get_module(session, module_id)
    if module is None:
        raise ApiError(
            status.HTTP_404_NOT_FOUND,
            "module_not_found",
            f"No module with id {module_id!r}.",
            {"module_id": module_id},
        )

    rows = catalogue.list_concepts(session, module_id)

    # Preserve the query's teaching order while grouping: topics appear in the
    # order their first concept appears.
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

    return ModuleConceptsOut(
        module=ModuleOut(
            module_id=module.module_id,
            code=module.code,
            name=module.name,
            description=module.description,
            topic_count=module.topic_count,
            concept_count=module.concept_count,
        ),
        topics=topics,
    )
