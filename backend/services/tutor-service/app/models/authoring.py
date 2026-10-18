"""What a lecturer sends and receives when managing practicals.

Unlike the student models, these carry the reference solution and the hidden tests, so they must
only ever be returned by lecturer routes.
"""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


class CheckOut(BaseModel):
    name: str
    status: Literal["pass", "warn", "fail"]
    detail: str = ""


class AuthorItemOut(BaseModel):
    practical_id: str
    slot_id: str
    concept_id: str
    concept_title: str
    title: str
    number: int
    level: int
    origin: Literal["authored", "generated", "manual"]
    status: Literal["draft", "approved", "rejected", "retired"]
    statement: str
    reference_solution: str
    checks: list[CheckOut]
    tests_total: int
    replaces: str | None = None
    replaced_by: str | None = None
    created_by: str | None = None
    created_at: datetime | None = None
    reviewed_by: str | None = None
    reviewed_at: datetime | None = None
    review_note: str | None = None
    can_approve: bool = False


class TestDetailOut(BaseModel):
    __test__ = False

    stdin: str
    expected: str
    visible: bool
    source: str


class AuthorDetailOut(AuthorItemOut):
    tests: list[TestDetailOut]
    slot_history: list[AuthorItemOut]


class AuthorOverviewOut(BaseModel):
    current: list[AuthorItemOut]  # what students see now
    drafts: list[AuthorItemOut]  # waiting for a decision
    history: list[AuthorItemOut]  # replaced or rejected, kept for the record


class DraftIn(BaseModel):
    concept_id: str
    statement: str = Field(min_length=1)
    reference_solution: str = Field(min_length=1)
    level: int = 4
    replaces: str | None = None  # a current practical's id; empty means add a new one
    suggest_tests: bool = True  # let the model propose extra test inputs


class EditIn(BaseModel):
    statement: str | None = None
    reference_solution: str | None = None
    level: int | None = None
    suggest_tests: bool = True


class ReviewIn(BaseModel):
    note: str | None = Field(default=None, max_length=1000)


class GenerateIn(BaseModel):
    concept_id: str
    count: int = Field(default=1, ge=1, le=6)
    replaces: list[str] | None = None  # specific practicals to aim at; otherwise in order
    hint: str | None = Field(default=None, max_length=500)


class JobOut(BaseModel):
    job_id: str
    concept_id: str
    status: Literal["queued", "running", "finished", "failed"]
    requested: int
    done: int
    failed: int
    hint: str | None = None
    draft_ids: list[str]  # the drafts made so far, as practical ids
    message: str | None = None
    created_at: datetime | None = None
    finished_at: datetime | None = None


class BulkIn(BaseModel):
    practical_ids: list[str] = Field(min_length=1, max_length=50)
    note: str | None = Field(default=None, max_length=1000)


class BulkResultOut(BaseModel):
    practical_id: str
    ok: bool
    code: str | None = None
    message: str | None = None


class BulkOut(BaseModel):
    results: list[BulkResultOut]
