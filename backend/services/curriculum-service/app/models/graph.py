"""Request and response shapes for the prerequisite graph and its edits."""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

from app.models.mastery import CONCEPT_ID_PATTERN


class GraphNode(BaseModel):
    concept_id: str
    name: str
    module_id: str
    topic_id: str
    topic_name: str
    position: int
    depth: int
    prerequisite_count: int


class GraphEdge(BaseModel):
    """`prerequisite_id` must be learned before `concept_id`."""

    concept_id: str
    prerequisite_id: str
    cross_module: bool


class GraphStats(BaseModel):
    concepts: int
    edges: int
    cross_module_edges: int
    max_depth: int


class GraphResponse(BaseModel):
    graph_version: str
    source: str
    fallback_reason: str | None
    module_id: str | None
    nodes: list[GraphNode]
    edges: list[GraphEdge]
    stats: GraphStats


class GraphEditIn(BaseModel):
    action: Literal["add_edge", "remove_edge"]
    concept_id: str = Field(pattern=CONCEPT_ID_PATTERN)
    prerequisite_id: str = Field(pattern=CONCEPT_ID_PATTERN)  # learned before concept_id
    reason: str = Field(min_length=3, max_length=500)  # kept in the audit log


class GraphEditOut(BaseModel):
    graph_version: str
    edges: int
    action: str
    concept_id: str
    prerequisite_id: str


class AuditEntryOut(BaseModel):
    changed_at: datetime | None
    actor: str
    action: str
    concept_id: str | None
    prerequisite_id: str | None
    graph_version: str
    details: dict
