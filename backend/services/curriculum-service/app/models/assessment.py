"""Request and response shapes for the pre/post tests, the study window and gain."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

ITEM_ID_PATTERN = r"^[A-Za-z0-9._:-]{1,64}$"


class AttemptOut(BaseModel):
    started_at: datetime
    submitted_at: datetime | None
    score_pct: float | None  # main section only; None until submitted
    main_correct: int | None
    main_total: int | None


class TestStatusOut(BaseModel):
    module_id: str
    phase: str
    open_test: Literal["pretest", "posttest"] | None
    pretest: AttemptOut | None
    posttest: AttemptOut | None


class ItemOut(BaseModel):
    """A question as the learner sees it: never the answer."""

    item_id: str
    position: int
    section: Literal["main", "prereq"]
    stem: str
    options: list[str]


class TestPaperOut(BaseModel):
    module_id: str
    kind: Literal["pretest", "posttest"]
    attempt: AttemptOut
    items: list[ItemOut]


class AnswerIn(BaseModel):
    item_id: str = Field(pattern=ITEM_ID_PATTERN)
    chosen_index: int | None = Field(default=None, ge=0, le=9)  # None = left blank


class SubmitIn(BaseModel):
    answers: list[AnswerIn] = Field(max_length=100)


class SubmitOut(BaseModel):
    module_id: str
    kind: Literal["pretest", "posttest"]
    repeat: bool  # True when this test was already submitted; nothing was re-scored
    attempt: AttemptOut


class GainLineOut(BaseModel):
    pre_pct: float
    post_pct: float
    gain: float | None  # None when the pre-test score was 100


class GainOut(BaseModel):
    module_id: str
    overall: GainLineOut
    by_topic: dict[str, GainLineOut]
    by_concept: dict[str, GainLineOut]


class WindowIn(BaseModel):
    phase: Literal["closed", "pretest", "learning", "posttest", "finished"]


class WindowOut(BaseModel):
    module_id: str
    phase: str


class CohortRowOut(BaseModel):
    user_id: uuid.UUID
    group: str
    form_order: str
    pre_pct: float
    post_pct: float
    gain: float | None


class GroupSummaryOut(BaseModel):
    learners: int
    mean_pre: float | None
    mean_post: float | None
    mean_gain: float | None
    class_gain: float | None


class CohortGainOut(BaseModel):
    module_id: str
    enrolled: int
    pretest_done: int
    posttest_done: int
    groups: dict[str, GroupSummaryOut]
    learners: list[CohortRowOut]


class SnapshotValidationOut(BaseModel):
    module_id: str
    params_version: str
    answers: int
    learners: int
    correct_rate: float | None
    auc: float | None
    brier: float | None
    threshold_accuracy: float | None
