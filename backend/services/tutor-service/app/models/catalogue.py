"""Response schemas for the learner catalogue."""

from __future__ import annotations

from pydantic import BaseModel


class ModuleOut(BaseModel):
    module_id: str
    code: str | None = None
    name: str
    description: str | None = None
    topic_count: int
    concept_count: int


class ConceptOut(BaseModel):
    concept_id: str
    name: str
    description: str | None = None
    topic_id: str
    topic_name: str
    prerequisite_ids: list[str] = []


class TopicOut(BaseModel):
    topic_id: str
    name: str
    concepts: list[ConceptOut] = []


class ModuleConceptsOut(BaseModel):
    module: ModuleOut
    topics: list[TopicOut] = []
