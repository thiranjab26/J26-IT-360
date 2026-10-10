"""Lecturer and admin edits to the prerequisite graph, and the audit log (Objective 1, NFR-11)."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query, Request, status

from app.core.deps import CurrentUser, require_role
from app.core.errors import ApiError
from app.domain.graph_edit import GraphEditError, GraphEditor
from app.domain.graph_loader import GraphUnavailableError
from app.models.graph import AuditEntryOut, GraphEditIn, GraphEditOut

router = APIRouter(prefix="/graph", tags=["graph edits"])
staff = require_role("lecturer", "admin")

_STATUS = {
    "unknown_concept": status.HTTP_404_NOT_FOUND,
    "no_such_edge": status.HTTP_404_NOT_FOUND,
    "self_loop": status.HTTP_422_UNPROCESSABLE_ENTITY,
    "edge_exists": status.HTTP_409_CONFLICT,
    "creates_cycle": status.HTTP_409_CONFLICT,
}


def get_editor(request: Request) -> GraphEditor:
    editor = request.app.state.graph_runtime.editor()
    if editor is None:
        raise ApiError(
            status.HTTP_503_SERVICE_UNAVAILABLE, "edits_unavailable", "Graph editing is not set up."
        )
    return editor


@router.post("/edits", response_model=GraphEditOut, summary="Add or remove a prerequisite link")
def edit_graph(
    body: GraphEditIn,
    caller: CurrentUser = Depends(staff),
    editor: GraphEditor = Depends(get_editor),
) -> GraphEditOut:
    try:
        graph = editor.apply(
            caller.user_id, body.action, body.concept_id, body.prerequisite_id, body.reason
        )
    except GraphEditError as exc:
        raise ApiError(
            _STATUS.get(exc.code, status.HTTP_409_CONFLICT), exc.code, exc.message
        ) from exc
    except GraphUnavailableError as exc:
        raise ApiError(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "graph_unavailable",
            "The prerequisite graph is temporarily unavailable.",
        ) from exc
    return GraphEditOut(
        graph_version=graph.version,
        edges=len(graph.edges),
        action=body.action,
        concept_id=body.concept_id,
        prerequisite_id=body.prerequisite_id,
    )


@router.get(
    "/audit", response_model=list[AuditEntryOut], summary="Recent graph changes, newest first"
)
def read_audit(
    limit: int = Query(default=50, ge=1, le=500),
    _: CurrentUser = Depends(staff),
    editor: GraphEditor = Depends(get_editor),
) -> list[AuditEntryOut]:
    return [AuditEntryOut(**entry.__dict__) for entry in editor.audit(limit)]
