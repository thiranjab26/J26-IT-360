"""The signed-in learner's mastery and next recommended concept (FR-03 to FR-06)."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query, Request

from app.api.v1.routes.graph import MODULE_PATTERN, get_graph_cache, load_graph, module_view
from app.core.deps import CurrentUser, current_user
from app.domain.graph import PrerequisiteGraph
from app.domain.graph_loader import GraphCache
from app.domain.learner import Learner
from app.domain.mastery import MASTERY_THRESHOLD, MasteryRecord
from app.domain.recommend import Plan
from app.domain.study import Study
from app.models.mastery import (
    ConceptMastery,
    ConceptRef,
    LockedOut,
    MasteryResponse,
    PlanResponse,
    RecommendationOut,
)

router = APIRouter(prefix="/me", tags=["mastery"])


def get_learner(request: Request) -> Learner:
    return request.app.state.learner


def get_study(request: Request) -> Study:
    return request.app.state.study


def concept_mastery(
    graph: PrerequisiteGraph, concept_id: str, record: MasteryRecord | None
) -> ConceptMastery:
    concept = graph.concept(concept_id)
    return ConceptMastery(
        concept_id=concept_id,
        name=concept.name,
        module_id=concept.module_id,
        topic_id=concept.topic_id,
        mastery_score=round(record.score, 4) if record else None,
        is_mastered=record.is_mastered if record else False,
        evidence_count=record.evidence_count if record else 0,
        needs_reassessment=record.needs_reassessment if record else False,
        updated_at=record.updated_at if record else None,
    )


@router.get("/mastery", response_model=MasteryResponse, summary="My mastery per concept")
def read_my_mastery(
    module: str | None = Query(default=None, pattern=MODULE_PATTERN),
    caller: CurrentUser = Depends(current_user),
    cache: GraphCache = Depends(get_graph_cache),
    learner: Learner = Depends(get_learner),
) -> MasteryResponse:
    graph = load_graph(cache).graph
    view = graph if module is None else module_view(graph, module)
    records = learner.mastery(caller.user_id)
    return MasteryResponse(
        module_id=module,
        threshold=MASTERY_THRESHOLD,
        params_version=learner.params_version,
        concepts=[
            concept_mastery(graph, c.concept_id, records.get(c.concept_id)) for c in view.concepts
        ],
    )


@router.get(
    "/recommendation", response_model=PlanResponse, summary="What I should study next, and why"
)
def read_my_recommendation(
    module: str = Query(pattern=MODULE_PATTERN),
    caller: CurrentUser = Depends(current_user),
    cache: GraphCache = Depends(get_graph_cache),
    learner: Learner = Depends(get_learner),
    study: Study = Depends(get_study),
) -> PlanResponse:
    graph = load_graph(cache).graph
    module_view(graph, module)  # 404 for an unknown module
    # Comparison-group learners follow the syllabus; everyone else gets the adaptive order.
    fixed = study.group_of(caller.user_id, module) == "comparison"
    plan = learner.plan(caller.user_id, graph, module, fixed=fixed)
    return plan_response(graph, plan)


def plan_response(graph: PrerequisiteGraph, plan: Plan) -> PlanResponse:
    def ref(concept_id: str | None) -> ConceptRef | None:
        return (
            ConceptRef(concept_id=concept_id, name=graph.concept(concept_id).name)
            if concept_id
            else None
        )

    rec = plan.recommendation
    return PlanResponse(
        module_id=plan.module_id,
        graph_version=graph.version,
        complete=plan.complete,
        recommendation=None
        if rec is None
        else RecommendationOut(
            next_concept=ref(rec.next_concept_id),
            next_topic_id=rec.next_topic_id,
            target_concept=ref(rec.target_concept_id),
            weak_prerequisite=ref(rec.weak_prerequisite_id),
            readiness=round(rec.readiness, 4),
            explanation=rec.explanation,
            reason=rec.reason,
            model_version=rec.model_version,
        ),
        locked=[
            LockedOut(
                concept=ref(lock.concept_id),
                weak_prerequisite=ref(lock.weak_prerequisite_id),
                weak_prerequisite_mastery=round(lock.weak_prerequisite_mastery, 4),
            )
            for lock in plan.locked
        ],
    )
