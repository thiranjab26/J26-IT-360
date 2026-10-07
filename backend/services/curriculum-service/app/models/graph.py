"""Response shapes for the prerequisite graph."""

from __future__ import annotations

from pydantic import BaseModel


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
