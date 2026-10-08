"""GET /graph: the prerequisite graph of PF and DSA concepts (FR-01, FR-08)."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query, Request, status

from app.core.deps import CurrentUser, current_user
from app.core.errors import ApiError
from app.domain.graph import GraphError, PrerequisiteGraph
from app.domain.graph_loader import GraphCache, GraphUnavailableError, LoadedGraph
from app.models.graph import GraphEdge, GraphNode, GraphResponse, GraphStats

router = APIRouter(tags=["graph"])

MODULE_PATTERN = r"^[a-z]{2,16}$"


def get_graph_cache(request: Request) -> GraphCache:
    return request.app.state.graph_runtime.cache


def load_graph(cache: GraphCache) -> LoadedGraph:
    try:
        return cache.get()
    except GraphUnavailableError as exc:
        raise ApiError(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "graph_unavailable",
            "The prerequisite graph is temporarily unavailable.",
        ) from exc


def module_view(graph: PrerequisiteGraph, module: str) -> PrerequisiteGraph:
    try:
        return graph.for_module(module)
    except GraphError as exc:
        raise ApiError(
            status.HTTP_404_NOT_FOUND,
            "unknown_module",
            f"No concepts belong to module '{module}'.",
            {"modules": list(graph.module_ids())},
        ) from exc


@router.get("/graph", response_model=GraphResponse, summary="Prerequisite graph")
def read_graph(
    module: str | None = Query(
        default=None,
        pattern=MODULE_PATTERN,
        description="Limit to one module (e.g. dsa); its cross-module prerequisites are included.",
    ),
    _: CurrentUser = Depends(current_user),
    cache: GraphCache = Depends(get_graph_cache),
) -> GraphResponse:
    loaded = load_graph(cache)
    graph = loaded.graph if module is None else module_view(loaded.graph, module)

    nodes = [
        GraphNode(
            concept_id=c.concept_id,
            name=c.name,
            module_id=c.module_id,
            topic_id=c.topic_id,
            topic_name=c.topic_name,
            position=c.position,
            depth=graph.depth(c.concept_id),
            prerequisite_count=len(graph.prerequisites_of(c.concept_id)),
        )
        for c in graph.concepts
    ]
    edges = [GraphEdge(**e.__dict__) for e in graph.edges]
    return GraphResponse(
        graph_version=graph.version,
        source=loaded.source,
        fallback_reason=loaded.fallback_reason,
        module_id=module,
        nodes=nodes,
        edges=edges,
        stats=GraphStats(
            concepts=len(nodes),
            edges=len(edges),
            cross_module_edges=sum(e.cross_module for e in edges),
            max_depth=max((n.depth for n in nodes), default=0),
        ),
    )
