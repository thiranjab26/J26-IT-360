"""What the browser sends and receives for practicals.

The reference solution and the hidden tests' inputs and expected outputs never appear here.
A hidden test reports only whether it passed.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

from app.models.sessions import RewardsOut


class VisibleTestOut(BaseModel):
    stdin: str
    expected: str


class PracticalSummaryOut(BaseModel):
    practical_id: str
    concept_id: str
    concept_title: str
    level: int
    title: str
    unlocked: bool
    ready: bool  # False until its tests have been built
    passed: bool
    best: str | None = None  # for example "4 of 7", after at least one submission


class PracticalListOut(BaseModel):
    practicals: list[PracticalSummaryOut]


class PracticalOut(BaseModel):
    practical_id: str
    concept_id: str
    concept_title: str
    level: int
    title: str
    statement: str
    starter_code: str
    last_source: str | None = None  # the student's most recent submission, to continue from
    visible_tests: list[VisibleTestOut]
    tests_total: int
    passed: bool


class RunIn(BaseModel):
    source: str = Field(max_length=20_000)
    stdin: str = Field(default="", max_length=10_000)


class RunOut(BaseModel):
    compiled: bool
    compile_output: str = ""
    status: Literal["ok", "runtime_error", "timeout", "output_limit", "not_compiled"]
    stdout: str = ""
    stderr: str = ""
    ms: int = 0


class SubmitIn(BaseModel):
    source: str = Field(max_length=20_000)


class TestResultOut(BaseModel):
    __test__ = False

    number: int
    visible: bool
    passed: bool
    status: Literal["ok", "runtime_error", "timeout", "output_limit"]
    # Only for visible tests. A hidden test says whether it passed and nothing more.
    stdin: str | None = None
    expected: str | None = None
    actual: str | None = None
    ms: int = 0


class SubmitOut(BaseModel):
    compiled: bool
    compile_output: str = ""
    passed: bool
    tests_passed: int
    tests_total: int
    results: list[TestResultOut] = []
    # Set the first time the practical is passed: the XP, any badge, any level up.
    rewards: RewardsOut | None = None
