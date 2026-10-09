"""Lecturer and admin view of the study: window control, cohort gain, BKT validity."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Path

from app.api.v1.routes.assessment import gain_line, known_module, topics
from app.api.v1.routes.graph import MODULE_PATTERN, get_graph_cache
from app.api.v1.routes.mastery import get_study
from app.core.deps import CurrentUser, require_role
from app.domain.graph_loader import GraphCache
from app.domain.study import Study
from app.models.assessment import (
    CohortGainOut,
    CohortRowOut,
    GroupSummaryOut,
    SnapshotValidationOut,
    WindowIn,
    WindowOut,
)

router = APIRouter(prefix="/study", tags=["study"])

staff = require_role("lecturer", "admin")
ModulePath = Path(pattern=MODULE_PATTERN)


def _round(value: float | None, digits: int = 4) -> float | None:
    return None if value is None else round(value, digits)


@router.get("/{module}/window", response_model=WindowOut, summary="Current study phase")
def read_window(
    module: str = ModulePath,
    _: CurrentUser = Depends(staff),
    cache: GraphCache = Depends(get_graph_cache),
    study: Study = Depends(get_study),
) -> WindowOut:
    known_module(cache, module)
    return WindowOut(module_id=module, phase=study.window(module))


@router.put("/{module}/window", response_model=WindowOut, summary="Open or close a test")
def update_window(
    body: WindowIn,
    module: str = ModulePath,
    caller: CurrentUser = Depends(staff),
    cache: GraphCache = Depends(get_graph_cache),
    study: Study = Depends(get_study),
) -> WindowOut:
    known_module(cache, module)
    study.set_window(module, body.phase, caller.user_id)
    return WindowOut(module_id=module, phase=study.window(module))


@router.get("/{module}/gain", response_model=CohortGainOut, summary="Gain per learner and group")
def read_cohort_gain(
    module: str = ModulePath,
    _: CurrentUser = Depends(staff),
    cache: GraphCache = Depends(get_graph_cache),
    study: Study = Depends(get_study),
) -> CohortGainOut:
    graph = known_module(cache, module)
    cohort = study.cohort(module, topics(graph))
    return CohortGainOut(
        module_id=module,
        enrolled=cohort.enrolled,
        pretest_done=cohort.pretest_done,
        posttest_done=cohort.posttest_done,
        groups={
            group: GroupSummaryOut(
                learners=s.learners,
                mean_pre=_round(s.mean_pre, 2),
                mean_post=_round(s.mean_post, 2),
                mean_gain=_round(s.mean_gain),
                class_gain=_round(s.class_gain),
            )
            for group, s in cohort.groups.items()
        },
        learners=[
            CohortRowOut(
                user_id=row.user_id,
                group=row.group,
                form_order=row.form_order,
                **gain_line(row.line).model_dump(),
            )
            for row in cohort.rows
        ],
    )


@router.get(
    "/{module}/snapshot-validation",
    response_model=SnapshotValidationOut,
    summary="Does mastery at post-test start predict the post-test answers?",
)
def read_snapshot_validation(
    module: str = ModulePath,
    _: CurrentUser = Depends(staff),
    cache: GraphCache = Depends(get_graph_cache),
    study: Study = Depends(get_study),
) -> SnapshotValidationOut:
    known_module(cache, module)
    result = study.snapshot_validation(module)
    return SnapshotValidationOut(
        module_id=module,
        params_version=study.learner.params_version,
        answers=result.answers,
        learners=result.learners,
        correct_rate=_round(result.correct_rate),
        auc=_round(result.auc),
        brier=_round(result.brier),
        threshold_accuracy=_round(result.threshold_accuracy),
    )
