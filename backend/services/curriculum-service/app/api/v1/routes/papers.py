"""Lecturer question editor for the pre/post test papers (draft, publish, revise, lock)."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Path, Query, Request, Response, status

from app.api.v1.routes.assessment import known_module
from app.api.v1.routes.graph import MODULE_PATTERN, get_graph_cache, load_graph
from app.core.deps import CurrentUser, require_role
from app.core.errors import ApiError
from app.domain.assessment import AssessmentError
from app.domain.graph_loader import GraphCache
from app.domain.papers import ItemDraft, Papers, PaperVersion, PublishError, current
from app.models.assessment import ITEM_ID_PATTERN
from app.models.papers import (
    ItemIn,
    PaperIn,
    PaperOut,
    PaperSummaryOut,
    PublishOut,
    StaffItemOut,
    TitleIn,
)

router = APIRouter(prefix="/papers", tags=["question editor"])
staff = require_role("lecturer", "admin")
PaperPath = Path(pattern=ITEM_ID_PATTERN)
ItemPath = Path(pattern=ITEM_ID_PATTERN)

_STATUS = {
    "no_paper": status.HTTP_404_NOT_FOUND,
    "no_item": status.HTTP_404_NOT_FOUND,
    "unknown_concept": status.HTTP_422_UNPROCESSABLE_ENTITY,
    "bad_item": status.HTTP_422_UNPROCESSABLE_ENTITY,
    "publish_failed": status.HTTP_422_UNPROCESSABLE_ENTITY,
}


def get_papers(request: Request) -> Papers:
    return request.app.state.papers


def _error(exc: AssessmentError) -> ApiError:
    details = {"problems": exc.problems} if isinstance(exc, PublishError) else None
    return ApiError(_STATUS.get(exc.code, status.HTTP_409_CONFLICT), exc.code, exc.message, details)


def _known_concepts(cache: GraphCache) -> set[str]:
    return {c.concept_id for c in load_graph(cache).graph.concepts}


def _summary(version: PaperVersion, siblings: list[PaperVersion]) -> dict:
    sections = [i.section for i in version.paper.items]
    paper = version.paper
    return {
        "paper_id": paper.paper_id,
        "module_id": paper.module_id,
        "form": paper.form,
        "title": paper.title,
        "version": version.version,
        "status": version.status,
        "current": current(siblings, paper.form) == version,
        "main_items": sections.count("main"),
        "prereq_items": sections.count("prereq"),
        "published_at": version.published_at,
        "locked_at": version.locked_at,
    }


def _paper_out(papers: Papers, version: PaperVersion) -> PaperOut:
    siblings = papers.list(version.paper.module_id)
    return PaperOut(
        **_summary(version, siblings),
        items=[
            StaffItemOut(
                item_id=i.item_id,
                position=i.position,
                concept_id=i.concept_id,
                section=i.section,
                stem=i.stem,
                options=list(i.options),
                answer_index=i.answer_index,
                twin_item_id=i.twin_item_id,
            )
            for i in version.paper.items
        ],
    )


def _draft(body: ItemIn) -> ItemDraft:
    return ItemDraft(
        concept_id=body.concept_id,
        section=body.section,
        stem=body.stem,
        options=tuple(body.options),
        answer_index=body.answer_index,
        twin_item_id=body.twin_item_id,
        position=body.position,
    )


@router.get("", response_model=list[PaperSummaryOut], summary="Every paper version of a module")
def list_papers(
    module: str = Query(pattern=MODULE_PATTERN),
    _: CurrentUser = Depends(staff),
    cache: GraphCache = Depends(get_graph_cache),
    papers: Papers = Depends(get_papers),
) -> list[PaperSummaryOut]:
    known_module(cache, module)
    versions = papers.list(module)
    return [PaperSummaryOut(**_summary(v, versions)) for v in versions]


@router.post(
    "", response_model=PaperOut, status_code=201, summary="Start an empty draft for a new form"
)
def create_paper(
    body: PaperIn,
    module: str = Query(pattern=MODULE_PATTERN),
    caller: CurrentUser = Depends(staff),
    cache: GraphCache = Depends(get_graph_cache),
    papers: Papers = Depends(get_papers),
) -> PaperOut:
    known_module(cache, module)
    try:
        version = papers.create(module, body.form, body.title, caller.user_id)
    except AssessmentError as exc:
        raise _error(exc) from exc
    return _paper_out(papers, version)


@router.post("/publish", response_model=PublishOut, summary="Check and publish a module's drafts")
def publish_papers(
    module: str = Query(pattern=MODULE_PATTERN),
    caller: CurrentUser = Depends(staff),
    cache: GraphCache = Depends(get_graph_cache),
    papers: Papers = Depends(get_papers),
) -> PublishOut:
    known_module(cache, module)
    try:
        published = papers.publish(module, _known_concepts(cache), caller.user_id)
    except AssessmentError as exc:
        raise _error(exc) from exc
    return PublishOut(module_id=module, published=published)


@router.get("/{paper_id}", response_model=PaperOut, summary="A paper with its answers")
def read_paper(
    paper_id: str = PaperPath,
    _: CurrentUser = Depends(staff),
    papers: Papers = Depends(get_papers),
) -> PaperOut:
    try:
        return _paper_out(papers, papers.get(paper_id))
    except AssessmentError as exc:
        raise _error(exc) from exc


@router.patch("/{paper_id}", response_model=PaperOut, summary="Rename a draft")
def rename_paper(
    body: TitleIn,
    paper_id: str = PaperPath,
    caller: CurrentUser = Depends(staff),
    papers: Papers = Depends(get_papers),
) -> PaperOut:
    try:
        return _paper_out(papers, papers.rename(paper_id, body.title, caller.user_id))
    except AssessmentError as exc:
        raise _error(exc) from exc


@router.delete("/{paper_id}", status_code=204, summary="Discard a draft")
def discard_paper(
    paper_id: str = PaperPath,
    caller: CurrentUser = Depends(staff),
    papers: Papers = Depends(get_papers),
) -> Response:
    try:
        papers.discard(paper_id, caller.user_id)
    except AssessmentError as exc:
        raise _error(exc) from exc
    return Response(status_code=204)


@router.post(
    "/{paper_id}/revise",
    response_model=PaperOut,
    status_code=201,
    summary="Copy a published or locked paper into a new draft version",
)
def revise_paper(
    paper_id: str = PaperPath,
    caller: CurrentUser = Depends(staff),
    papers: Papers = Depends(get_papers),
) -> PaperOut:
    try:
        return _paper_out(papers, papers.revise(paper_id, caller.user_id))
    except AssessmentError as exc:
        raise _error(exc) from exc


@router.post(
    "/{paper_id}/items", response_model=StaffItemOut, status_code=201, summary="Add a question"
)
def add_item(
    body: ItemIn,
    paper_id: str = PaperPath,
    caller: CurrentUser = Depends(staff),
    cache: GraphCache = Depends(get_graph_cache),
    papers: Papers = Depends(get_papers),
) -> StaffItemOut:
    try:
        item = papers.add_item(paper_id, _draft(body), _known_concepts(cache), caller.user_id)
    except AssessmentError as exc:
        raise _error(exc) from exc
    return StaffItemOut(**{**item.__dict__, "options": list(item.options)})


@router.put(
    "/{paper_id}/items/{item_id}", response_model=StaffItemOut, summary="Replace a question"
)
def update_item(
    body: ItemIn,
    paper_id: str = PaperPath,
    item_id: str = ItemPath,
    caller: CurrentUser = Depends(staff),
    cache: GraphCache = Depends(get_graph_cache),
    papers: Papers = Depends(get_papers),
) -> StaffItemOut:
    try:
        item = papers.update_item(
            paper_id, item_id, _draft(body), _known_concepts(cache), caller.user_id
        )
    except AssessmentError as exc:
        raise _error(exc) from exc
    return StaffItemOut(**{**item.__dict__, "options": list(item.options)})


@router.delete("/{paper_id}/items/{item_id}", status_code=204, summary="Remove a question")
def remove_item(
    paper_id: str = PaperPath,
    item_id: str = ItemPath,
    caller: CurrentUser = Depends(staff),
    papers: Papers = Depends(get_papers),
) -> Response:
    try:
        papers.remove_item(paper_id, item_id, caller.user_id)
    except AssessmentError as exc:
        raise _error(exc) from exc
    return Response(status_code=204)
