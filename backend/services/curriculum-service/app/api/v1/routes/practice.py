"""Practice (C3 stand-in): server-checked questions feeding BKT. Mounted only in stub mode."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query, Request, status

from app.api.v1.routes.graph import get_graph_cache, load_graph
from app.api.v1.routes.mastery import concept_mastery
from app.core.deps import CurrentUser, current_user
from app.core.errors import ApiError
from app.domain.graph import PrerequisiteGraph
from app.domain.graph_loader import GraphCache
from app.domain.practice import Practice, PracticeError
from app.models.mastery import CONCEPT_ID_PATTERN, ConceptRef
from app.models.practice import (
    HintIn,
    HintOut,
    PracticeAnswerIn,
    PracticeAnswerOut,
    PracticeItemOut,
)

router = APIRouter(prefix="/me/practice", tags=["practice (C3 stand-in)"])

_STATUS = {
    "no_practice_items": status.HTTP_404_NOT_FOUND,
    "unknown_item": status.HTTP_404_NOT_FOUND,
    "no_hint": status.HTTP_404_NOT_FOUND,
    "bad_choice": status.HTTP_422_UNPROCESSABLE_ENTITY,
}


def get_practice(request: Request) -> Practice:
    return request.app.state.practice


def _error(exc: PracticeError) -> ApiError:
    return ApiError(_STATUS.get(exc.code, status.HTTP_409_CONFLICT), exc.code, exc.message)


def _known_concept(graph: PrerequisiteGraph, concept_id: str) -> None:
    if concept_id not in graph:
        raise ApiError(status.HTTP_404_NOT_FOUND, "unknown_concept", "No such concept.")


@router.get("/next", response_model=PracticeItemOut, summary="My next practice question")
def next_question(
    concept: str = Query(pattern=CONCEPT_ID_PATTERN),
    caller: CurrentUser = Depends(current_user),
    cache: GraphCache = Depends(get_graph_cache),
    practice: Practice = Depends(get_practice),
) -> PracticeItemOut:
    graph = load_graph(cache).graph
    _known_concept(graph, concept)
    try:
        item = practice.next(caller.user_id, concept)
    except PracticeError as exc:
        raise _error(exc) from exc
    return PracticeItemOut(
        item_id=item.item_id,
        concept=ConceptRef(concept_id=concept, name=graph.concept(concept).name),
        stem=item.stem,
        options=list(item.options),
        has_hint=bool(item.hint),
    )


@router.post(
    "/hint", response_model=HintOut, summary="Show the hint (the answer then counts as wrong)"
)
def show_hint(
    body: HintIn,
    caller: CurrentUser = Depends(current_user),
    practice: Practice = Depends(get_practice),
) -> HintOut:
    try:
        hint, used = practice.hint(caller.user_id, body.item_id)
    except PracticeError as exc:
        raise _error(exc) from exc
    return HintOut(hint=hint, hints_used=used)


@router.post("/answer", response_model=PracticeAnswerOut, summary="Answer; checked on the server")
def answer_question(
    body: PracticeAnswerIn,
    caller: CurrentUser = Depends(current_user),
    cache: GraphCache = Depends(get_graph_cache),
    practice: Practice = Depends(get_practice),
) -> PracticeAnswerOut:
    graph = load_graph(cache).graph
    try:
        result = practice.answer(caller.user_id, body.item_id, body.chosen_index)
    except PracticeError as exc:
        raise _error(exc) from exc
    return PracticeAnswerOut(
        correct=result.correct,
        right_option=result.right_option,
        counted=result.counted,
        counted_as_correct=result.counted_as_correct,
        hints_used=result.hints_used,
        mastery=concept_mastery(graph, result.concept_id, result.record),
    )
