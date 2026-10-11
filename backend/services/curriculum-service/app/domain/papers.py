"""Lecturer question management for the pre/post test papers.

Lifecycle per paper: draft -> published -> locked. Only drafts change. A paper
locks when the first learner starts it, and locked papers never change, so
every attempt keeps the exact questions it was given. To change a published or
locked paper the lecturer revises it into a new draft version; leaving a
question out of that version retires it. Publishing is per module and checks
both forms together, so learners never get forms whose twins do not match.
"""

from __future__ import annotations

import secrets
import uuid
from collections.abc import Callable, Iterable, Sequence
from dataclasses import dataclass, replace
from datetime import datetime
from typing import Literal, Protocol

from app.domain.assessment import (
    MAIN_ITEMS_PER_PAPER,
    AssessmentError,
    Item,
    Paper,
    Section,
    check_bank,
    item_root,
)

PaperStatus = Literal["draft", "published", "locked"]
Form = Literal["A", "B"]
FORMS: tuple[Form, ...] = ("A", "B")


class PublishError(AssessmentError):
    def __init__(self, problems: list[str]) -> None:
        super().__init__("publish_failed", "The papers are not ready to publish.")
        self.problems = problems


@dataclass(frozen=True)
class PaperVersion:
    paper: Paper
    version: int
    status: PaperStatus
    published_at: datetime | None = None
    locked_at: datetime | None = None

    @property
    def paper_id(self) -> str:
        return self.paper.paper_id


@dataclass(frozen=True)
class ItemDraft:
    """A question as the lecturer writes it; `position` None = keep (or append when new)."""

    concept_id: str
    section: Section
    stem: str
    options: tuple[str, ...]
    answer_index: int
    twin_item_id: str | None = None
    position: int | None = None


@dataclass(frozen=True)
class Changes:
    save: tuple[PaperVersion, ...] = ()  # drafts to insert or overwrite, items included
    discard: tuple[str, ...] = ()  # draft paper ids to delete
    publish: tuple[str, ...] = ()  # draft paper ids to publish


# The module's papers (all versions, read under the module lock) -> what to write.
Plan = Callable[[list[PaperVersion]], Changes]


class PaperRepository(Protocol):
    def read(self, module_id: str) -> list[PaperVersion]: ...

    def module_of(self, paper_id: str) -> str | None: ...

    def write(self, module_id: str, plan: Plan, by: uuid.UUID) -> Changes:
        """One transaction under a per-module lock: read, plan, apply."""
        ...


def current(versions: Iterable[PaperVersion], form: str) -> PaperVersion | None:
    """The version new learners get: the newest published or locked one."""
    live = [v for v in versions if v.paper.form == form and v.status != "draft"]
    return max(live, key=lambda v: v.version, default=None)


def draft_of(versions: Iterable[PaperVersion], form: str) -> PaperVersion | None:
    return next((v for v in versions if v.paper.form == form and v.status == "draft"), None)


class Papers:
    def __init__(
        self,
        repository: PaperRepository,
        main_items: int = MAIN_ITEMS_PER_PAPER,
        new_token: Callable[[], str] = lambda: secrets.token_hex(4),
    ) -> None:
        self.repository = repository
        self.main_items = main_items
        self._token = new_token

    # --- reading ------------------------------------------------------------

    def list(self, module_id: str) -> list[PaperVersion]:
        return sorted(self.repository.read(module_id), key=lambda v: (v.paper.form, v.version))

    def get(self, paper_id: str) -> PaperVersion:
        module_id = self._module(paper_id)
        return _find(self.repository.read(module_id), paper_id)

    # --- papers -------------------------------------------------------------

    def create(self, module_id: str, form: Form, title: str, by: uuid.UUID) -> PaperVersion:
        """A first, empty draft for a form that has no paper yet."""

        def plan(versions: list[PaperVersion]) -> Changes:
            if any(v.paper.form == form for v in versions):
                raise AssessmentError(
                    "paper_exists", "This form already has a paper; revise it instead."
                )
            paper = Paper(f"{module_id}-{form}", module_id, form, title, ())
            return Changes(save=(PaperVersion(paper, 1, "draft"),))

        return self.repository.write(module_id, plan, by).save[0]

    def revise(self, paper_id: str, by: uuid.UUID) -> PaperVersion:
        """Copy the current published or locked version into a new draft version."""
        module_id = self._module(paper_id)

        def plan(versions: list[PaperVersion]) -> Changes:
            source = _find(versions, paper_id)
            form = source.paper.form
            if source.status == "draft":
                raise AssessmentError("already_draft", "This paper is a draft; edit it directly.")
            if draft_of(versions, form) is not None:
                raise AssessmentError("draft_exists", "This form already has a draft.")
            if current(versions, form) != source:
                raise AssessmentError("not_current", "Only the newest version can be revised.")
            number = max(v.version for v in versions if v.paper.form == form) + 1
            items = tuple(
                replace(i, item_id=f"{item_root(i.item_id)}:v{number}") for i in source.paper.items
            )
            paper = replace(source.paper, paper_id=f"{module_id}-{form}-v{number}", items=items)
            return Changes(save=(PaperVersion(paper, number, "draft"),))

        return self.repository.write(module_id, plan, by).save[0]

    def rename(self, paper_id: str, title: str, by: uuid.UUID) -> PaperVersion:
        return self._edit(paper_id, by, lambda paper: replace(paper, title=title))

    def discard(self, paper_id: str, by: uuid.UUID) -> None:
        """Delete a draft; published and locked papers are never deleted."""
        module_id = self._module(paper_id)

        def plan(versions: list[PaperVersion]) -> Changes:
            _require_draft(_find(versions, paper_id))
            return Changes(discard=(paper_id,))

        self.repository.write(module_id, plan, by)

    def publish(self, module_id: str, known_concepts: Iterable[str], by: uuid.UUID) -> list[str]:
        """Publish every draft of the module after checking both forms as learners get them."""
        known = set(known_concepts)

        def plan(versions: list[PaperVersion]) -> Changes:
            drafts = [v for v in versions if v.status == "draft"]
            if not drafts:
                raise AssessmentError("nothing_to_publish", "There is no draft to publish.")
            pair = [
                p.paper
                for form in FORMS
                if (p := draft_of(versions, form) or current(versions, form)) is not None
            ]
            problems = check_bank(pair, known, self.main_items)
            if problems:
                raise PublishError(problems)
            return Changes(publish=tuple(v.paper_id for v in drafts))

        return list(self.repository.write(module_id, plan, by).publish)

    # --- items --------------------------------------------------------------

    def add_item(
        self, paper_id: str, draft: ItemDraft, known_concepts: Iterable[str], by: uuid.UUID
    ) -> Item:
        _check_item(draft, set(known_concepts))
        token = self._token()

        def edit(paper: Paper) -> Paper:
            items = list(paper.items)
            at = len(items) if draft.position is None else _clamp(draft.position, len(items) + 1)
            items.insert(at, _item(f"{paper.module_id}-{paper.form}-{token}", draft))
            return replace(paper, items=_renumber(items))

        saved = self._edit(paper_id, by, edit)
        return _item_of(saved, f"{saved.paper.module_id}-{saved.paper.form}-{token}")

    def update_item(
        self,
        paper_id: str,
        item_id: str,
        draft: ItemDraft,
        known_concepts: Iterable[str],
        by: uuid.UUID,
    ) -> Item:
        _check_item(draft, set(known_concepts))

        def edit(paper: Paper) -> Paper:
            items = list(paper.items)
            at = _index(items, item_id)
            items.pop(at)
            if draft.position is not None:
                at = _clamp(draft.position, len(items) + 1)
            items.insert(at, _item(item_id, draft))
            return replace(paper, items=_renumber(items))

        return _item_of(self._edit(paper_id, by, edit), item_id)

    def remove_item(self, paper_id: str, item_id: str, by: uuid.UUID) -> None:
        def edit(paper: Paper) -> Paper:
            items = list(paper.items)
            items.pop(_index(items, item_id))
            return replace(paper, items=_renumber(items))

        self._edit(paper_id, by, edit)

    # --- helpers ------------------------------------------------------------

    def _module(self, paper_id: str) -> str:
        module_id = self.repository.module_of(paper_id)
        if module_id is None:
            raise AssessmentError("no_paper", "There is no paper with that id.")
        return module_id

    def _edit(self, paper_id: str, by: uuid.UUID, edit: Callable[[Paper], Paper]) -> PaperVersion:
        module_id = self._module(paper_id)

        def plan(versions: list[PaperVersion]) -> Changes:
            target = _find(versions, paper_id)
            _require_draft(target)
            return Changes(save=(replace(target, paper=edit(target.paper)),))

        return self.repository.write(module_id, plan, by).save[0]


def _find(versions: Sequence[PaperVersion], paper_id: str) -> PaperVersion:
    found = next((v for v in versions if v.paper_id == paper_id), None)
    if found is None:
        raise AssessmentError("no_paper", "There is no paper with that id.")
    return found


def _require_draft(version: PaperVersion) -> None:
    if version.status != "draft":
        raise AssessmentError(
            "not_draft", f"This paper is {version.status}; revise it to make changes."
        )


def _check_item(draft: ItemDraft, known: set[str]) -> None:
    options = [o.strip() for o in draft.options]
    if not draft.stem.strip():
        raise AssessmentError("bad_item", "The question needs a stem.")
    if len(options) < 2 or not all(options) or len(set(options)) != len(options):
        raise AssessmentError(
            "bad_item", "A question needs at least 2 distinct, non-empty options."
        )
    if not 0 <= draft.answer_index < len(options):
        raise AssessmentError("bad_item", "The answer must be one of the options.")
    if draft.concept_id not in known:
        raise AssessmentError("unknown_concept", "The concept is not in the prerequisite graph.")
    if draft.section == "prereq" and draft.twin_item_id:
        raise AssessmentError("bad_item", "Only main-section questions have twins.")


def _item(item_id: str, draft: ItemDraft) -> Item:
    return Item(
        item_id=item_id,
        position=0,  # set by _renumber
        concept_id=draft.concept_id,
        section=draft.section,
        stem=draft.stem.strip(),
        options=tuple(o.strip() for o in draft.options),
        answer_index=draft.answer_index,
        twin_item_id=draft.twin_item_id or None,
    )


def _renumber(items: list[Item]) -> tuple[Item, ...]:
    return tuple(replace(item, position=n) for n, item in enumerate(items, start=1))


def _clamp(position: int, size: int) -> int:
    """1-based position -> 0-based index inside a list of `size` slots."""
    return min(max(position, 1), size) - 1


def _index(items: list[Item], item_id: str) -> int:
    for n, item in enumerate(items):
        if item.item_id == item_id:
            return n
    raise AssessmentError("no_item", "That question is not on this paper.")


def _item_of(version: PaperVersion, item_id: str) -> Item:
    return next(i for i in version.paper.items if i.item_id == item_id)
