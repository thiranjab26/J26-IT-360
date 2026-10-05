"""The learner catalogue: modules and the concepts inside them.

Layer 6 of the C3 pipeline (the learner dashboard) starts here. Tutoring
sessions, checkpoints and the quest map build on these same two reads.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, status
from sqlalchemy.orm import Session

from app.core.deps import CurrentUser, current_user
from app.core.errors import ApiError
from app.db.session import get_session
from app.domain import catalogue
from app.models.catalogue import ConceptOut, ModuleConceptsOut, ModuleOut, TopicOut

router = APIRouter(tags=["catalogue"])


def _module_out(module: catalogue.ModuleSummary) -> ModuleOut:
    return ModuleOut(
        module_id=module.module_id,
        code=module.code,
        name=module.name,
        description=module.description,
        status=module.status,
        topic_count=module.topic_count,
        concept_count=module.concept_count,
    )


@router.get(
    "/modules",
    response_model=list[ModuleOut],
    summary="Modules the learner can study",
)
def list_modules(
    _caller: CurrentUser = Depends(current_user),
    session: Session = Depends(get_session),
) -> list[ModuleOut]:
    return [_module_out(module) for module in catalogue.list_modules(session)]


@router.get(
    "/modules/{module_id}/concepts",
    response_model=ModuleConceptsOut,
    summary="Concepts of one module, grouped by topic in teaching order",
)
def list_module_concepts(
    module_id: str,
    _caller: CurrentUser = Depends(current_user),
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

    # A coming-soon module has a seeded concept list (C1's graph needs the IDs)
    # but no authored content yet, so there is nothing for a learner to open.
    if not module.is_available:
        raise ApiError(
            status.HTTP_409_CONFLICT,
            "module_coming_soon",
            f"{module.name} is coming soon. Its course content is not available yet.",
            {"module_id": module_id},
        )

    return ModuleConceptsOut(
        module=_module_out(module),
        topics=[
            TopicOut(
                topic_id=topic_id,
                name=topic_name,
                concepts=[
                    ConceptOut(
                        concept_id=row.concept_id,
                        name=row.name,
                        description=row.description,
                        topic_id=row.topic_id,
                        topic_name=row.topic_name,
                        prerequisite_ids=row.prerequisite_ids,
                    )
                    for row in rows
                ],
            )
            for topic_id, topic_name, rows in catalogue.group_by_topic(
                catalogue.list_concepts(session, module_id)
            )
        ],
    )
