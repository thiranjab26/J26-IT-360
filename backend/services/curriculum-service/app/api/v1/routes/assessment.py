"""The signed-in learner's pre/post tests and learning gain (FR-12 to FR-14)."""

from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends, Path, Query, status

from app.api.v1.routes.graph import MODULE_PATTERN, get_graph_cache, load_graph, module_view
from app.api.v1.routes.mastery import get_study
from app.core.deps import CurrentUser, current_user
from app.core.errors import ApiError
from app.domain.assessment import AssessmentError, GainLine
from app.domain.graph import PrerequisiteGraph
from app.domain.graph_loader import GraphCache
from app.domain.study import Attempt, Study
from app.models.assessment import (
    AttemptOut,
    GainLineOut,
    GainOut,
    ItemOut,
    SubmitIn,
    SubmitOut,
    TestPaperOut,
    TestStatusOut,
)

router = APIRouter(prefix="/me", tags=["tests"])

KindPath = Path(pattern=r"^(pretest|posttest)$")

_STATUS = {
    "test_closed": status.HTTP_409_CONFLICT,
    "already_submitted": status.HTTP_409_CONFLICT,
    "pretest_required": status.HTTP_409_CONFLICT,
    "not_started": status.HTTP_409_CONFLICT,
    "no_gain_yet": status.HTTP_409_CONFLICT,
    "no_paper": status.HTTP_404_NOT_FOUND,
    "unknown_item": status.HTTP_422_UNPROCESSABLE_ENTITY,
    "bad_choice": status.HTTP_422_UNPROCESSABLE_ENTITY,
}


def as_api_error(exc: AssessmentError) -> ApiError:
    return ApiError(_STATUS.get(exc.code, status.HTTP_409_CONFLICT), exc.code, exc.message)


def known_module(cache: GraphCache, module: str) -> PrerequisiteGraph:
    graph = load_graph(cache).graph
    module_view(graph, module)  # 404 for an unknown module
    return graph


def topics(graph: PrerequisiteGraph) -> dict[str, str]:
    return {c.concept_id: c.topic_id for c in graph.concepts}


def attempt_out(attempt: Attempt | None) -> AttemptOut | None:
    if attempt is None:
        return None
    return AttemptOut(
        started_at=attempt.started_at,
        submitted_at=attempt.submitted_at,
        score_pct=None if attempt.score_pct is None else round(attempt.score_pct, 2),
        main_correct=attempt.main_correct,
        main_total=attempt.main_total,
    )


def gain_line(line: GainLine) -> GainLineOut:
    return GainLineOut(
        pre_pct=round(line.pre_pct, 2),
        post_pct=round(line.post_pct, 2),
        gain=None if line.gain is None else round(line.gain, 4),
    )


@router.get("/tests", response_model=TestStatusOut, summary="Which test is open and my results")
def read_my_tests(
    module: str = Query(pattern=MODULE_PATTERN),
    caller: CurrentUser = Depends(current_user),
    cache: GraphCache = Depends(get_graph_cache),
    study: Study = Depends(get_study),
) -> TestStatusOut:
    known_module(cache, module)
    state = study.status(caller.user_id, module)
    # The study group is never shown to the learner, so they stay blind to it.
    return TestStatusOut(
        module_id=module,
        phase=state.phase,
        open_test=state.open_test,
        pretest=attempt_out(state.pretest),
        posttest=attempt_out(state.posttest),
    )


@router.post(
    "/tests/{kind}/start",
    response_model=TestPaperOut,
    summary="Start (or resume) a test; the questions come without answers",
)
def start_my_test(
    kind: Literal["pretest", "posttest"] = KindPath,
    module: str = Query(pattern=MODULE_PATTERN),
    caller: CurrentUser = Depends(current_user),
    cache: GraphCache = Depends(get_graph_cache),
    study: Study = Depends(get_study),
) -> TestPaperOut:
    known_module(cache, module)
    try:
        attempt, items = study.start(caller.user_id, module, kind)
    except AssessmentError as exc:
        raise as_api_error(exc) from exc
    return TestPaperOut(
        module_id=module,
        kind=kind,
        attempt=attempt_out(attempt),  # type: ignore[arg-type]
        items=[
            ItemOut(
                item_id=i.item_id,
                position=i.position,
                section=i.section,
                stem=i.stem,
                options=list(i.options),
            )
            for i in items
        ],
    )


@router.post(
    "/tests/{kind}/submit",
    response_model=SubmitOut,
    summary="Submit my answers once; scored on the server",
)
def submit_my_test(
    body: SubmitIn,
    kind: Literal["pretest", "posttest"] = KindPath,
    module: str = Query(pattern=MODULE_PATTERN),
    caller: CurrentUser = Depends(current_user),
    cache: GraphCache = Depends(get_graph_cache),
    study: Study = Depends(get_study),
) -> SubmitOut:
    known_module(cache, module)
    answers = {a.item_id: a.chosen_index for a in body.answers}
    if len(answers) != len(body.answers):
        raise ApiError(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "duplicate_answer",
            "Each question can be answered only once.",
        )
    try:
        attempt, repeat = study.submit(caller.user_id, module, kind, answers)
    except AssessmentError as exc:
        raise as_api_error(exc) from exc
    return SubmitOut(module_id=module, kind=kind, repeat=repeat, attempt=attempt_out(attempt))  # type: ignore[arg-type]


@router.get("/gain", response_model=GainOut, summary="My learning gain from pre-test to post-test")
def read_my_gain(
    module: str = Query(pattern=MODULE_PATTERN),
    caller: CurrentUser = Depends(current_user),
    cache: GraphCache = Depends(get_graph_cache),
    study: Study = Depends(get_study),
) -> GainOut:
    graph = known_module(cache, module)
    try:
        report = study.gain(caller.user_id, module, topics(graph))
    except AssessmentError as exc:
        raise as_api_error(exc) from exc
    return GainOut(
        module_id=module,
        overall=gain_line(report.overall),
        by_topic={k: gain_line(v) for k, v in report.by_topic.items()},
        by_concept={k: gain_line(v) for k, v in report.by_concept.items()},
    )
