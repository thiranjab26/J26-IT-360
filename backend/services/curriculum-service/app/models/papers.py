"""Request and response shapes for the lecturer question editor (staff only)."""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

from app.models.assessment import ITEM_ID_PATTERN
from app.models.mastery import CONCEPT_ID_PATTERN


class PaperIn(BaseModel):
    form: Literal["A", "B"]
    title: str = Field(min_length=1, max_length=200)


class TitleIn(BaseModel):
    title: str = Field(min_length=1, max_length=200)


class ItemIn(BaseModel):
    concept_id: str = Field(pattern=CONCEPT_ID_PATTERN)
    section: Literal["main", "prereq"] = "main"
    stem: str = Field(min_length=1, max_length=4000)
    options: list[str] = Field(min_length=2, max_length=6)
    answer_index: int = Field(ge=0, le=5)
    twin_item_id: str | None = Field(default=None, pattern=ITEM_ID_PATTERN)
    position: int | None = Field(default=None, ge=1, le=200)  # None = keep, or append when new


class StaffItemOut(BaseModel):
    """Includes the answer: these routes are for lecturers and admins only."""

    item_id: str
    position: int
    concept_id: str
    section: Literal["main", "prereq"]
    stem: str
    options: list[str]
    answer_index: int
    twin_item_id: str | None


class PaperSummaryOut(BaseModel):
    paper_id: str
    module_id: str
    form: Literal["A", "B"]
    title: str
    version: int
    status: Literal["draft", "published", "locked"]
    current: bool  # the version new learners get
    main_items: int
    prereq_items: int
    published_at: datetime | None
    locked_at: datetime | None


class PaperOut(PaperSummaryOut):
    items: list[StaffItemOut]


class PublishOut(BaseModel):
    module_id: str
    published: list[str]
