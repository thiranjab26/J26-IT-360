"""GET /graph: the prerequisite graph of PF and DSA concepts (FR-01, FR-08)."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query, Request, status

from app.core.deps import CurrentUser, current_user
from app.core.errors import ApiError
from app.domain.graph import GraphError
from app.domain.graph_loader import GraphCache, GraphUnavailableError
from app.models.graph import GraphEdge, GraphNode, GraphResponse, GraphStats

router = APIRouter(tags=["graph"])


def get_graph_cache(request: Request) -> GraphCache:
    return request.app.state.graph_runtime.cache


@router.get("/graph", response_model=GraphResponse, summary="Prerequisite graph")
def read_graph(
    module: str | None = Query(
        default=None,
        pattern=r"^[a-z]{2,16}$",
        description="Limit to one module (e.g. dsa); its cross-module prerequisites are included.",
    ),
    _: CurrentUser = Depends(current_user),
    cache: GraphCache = Depends(get_graph_cache),
) -> GraphResponse:
    try:
        loaded = cache.get()
    except GraphUnavailableError as exc:
        raise ApiError(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "graph_unavailable",
            "The prerequisite graph is temporarily unavailable.",
        ) from exc

    graph = loaded.graph
    if module is not None:
        try:
            graph = graph.for_module(module)
        except GraphError as exc:
            raise ApiError(
                status.HTTP_404_NOT_FOUND,
                "unknown_module",
                f"No concepts belong to module '{module}'.",
                {"modules": list(loaded.graph.module_ids())},
            ) from exc

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
