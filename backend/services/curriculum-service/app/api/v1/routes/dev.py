"""Development-only routes, mounted only outside production in stub mode."""

from __future__ import annotations

from fastapi import APIRouter, Depends, status

from app.api.v1.routes.graph import get_graph_cache, load_graph
from app.api.v1.routes.mastery import concept_mastery, get_learner
from app.core.deps import CurrentUser, current_user
from app.core.errors import ApiError
from app.domain.graph_loader import GraphCache
from app.domain.learner import Learner
from app.domain.mastery import counts_as_correct
from app.models.mastery import StubAttemptIn, StubAttemptOut

router = APIRouter(prefix="/dev", tags=["dev"])


@router.post(
    "/attempts",
    response_model=StubAttemptOut,
    summary="C3 stand-in: record one practice attempt for me and update my mastery",
)
def record_stub_attempt(
    body: StubAttemptIn,
    caller: CurrentUser = Depends(current_user),
    cache: GraphCache = Depends(get_graph_cache),
    learner: Learner = Depends(get_learner),
) -> StubAttemptOut:
    graph = load_graph(cache).graph
    if body.concept_id not in graph:
        raise ApiError(status.HTTP_404_NOT_FOUND, "unknown_concept", "No such concept.")
    counted, record = learner.practise(
        caller.user_id, body.concept_id, body.item_id, body.correct, body.hints_used
    )
    return StubAttemptOut(
        counted=counted,
        counted_as_correct=counted and counts_as_correct(body.correct, body.hints_used),
        mastery=concept_mastery(graph, body.concept_id, record),
    )
