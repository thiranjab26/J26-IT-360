"""Pre/post tests: counterbalancing, server-side scoring, normalised gain, BKT validity."""

from __future__ import annotations

import random
from collections import Counter, defaultdict
from collections.abc import Callable, Iterable, Mapping, Sequence
from dataclasses import dataclass
from typing import Literal

from app.domain.mastery import MASTERY_THRESHOLD, BktParams

TestKind = Literal["pretest", "posttest"]
Phase = Literal["closed", "pretest", "learning", "posttest", "finished"]
Group = Literal["adaptive", "comparison"]
FormOrder = Literal["AB", "BA"]
Section = Literal["main", "prereq"]

PHASES: tuple[Phase, ...] = ("closed", "pretest", "learning", "posttest", "finished")
TEST_KINDS: tuple[TestKind, ...] = ("pretest", "posttest")
# 2 groups x 2 form orders; each new learner fills one of the least-used cells.
CELLS: tuple[tuple[Group, FormOrder], ...] = (
    ("adaptive", "AB"),
    ("adaptive", "BA"),
    ("comparison", "AB"),
    ("comparison", "BA"),
)
MAIN_ITEMS_PER_PAPER = 24


class AssessmentError(Exception):
    """A rule of the study was broken; `code` is stable for the API."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


@dataclass(frozen=True)
class Enrolment:
    group: Group
    form_order: FormOrder


@dataclass(frozen=True)
class Item:
    item_id: str
    position: int
    concept_id: str
    section: Section
    stem: str
    options: tuple[str, ...]
    answer_index: int
    twin_item_id: str | None = None


@dataclass(frozen=True)
class Paper:
    paper_id: str
    module_id: str
    form: Literal["A", "B"]
    title: str
    items: tuple[Item, ...]

    def items_for(self, kind: TestKind) -> tuple[Item, ...]:
        """The prerequisite section only sets starting mastery, so only the pre-test has it."""
        return tuple(i for i in self.items if kind == "pretest" or i.section == "main")


@dataclass(frozen=True)
class Response:
    item_id: str
    concept_id: str
    section: Section
    chosen_index: int | None
    correct: bool


@dataclass(frozen=True)
class Scored:
    responses: tuple[Response, ...]
    main_correct: int
    main_total: int

    @property
    def score_pct(self) -> float:
        return 100.0 * self.main_correct / self.main_total if self.main_total else 0.0


def open_test(phase: Phase) -> TestKind | None:
    return phase if phase in TEST_KINDS else None  # type: ignore[return-value]


def choose_cell(
    counts: Mapping[tuple[str, str], int], rng: Callable[[Sequence], object] = random.choice
) -> Enrolment:
    """Random among the least-filled cells, so groups and form orders stay balanced."""
    fewest = min(counts.get(cell, 0) for cell in CELLS)
    group, order = rng([cell for cell in CELLS if counts.get(cell, 0) == fewest])  # type: ignore[misc]
    return Enrolment(group, order)


def form_for(order: FormOrder, kind: TestKind) -> Literal["A", "B"]:
    first, second = order[0], order[1]
    return first if kind == "pretest" else second  # type: ignore[return-value]


def score(items: Sequence[Item], answers: Mapping[str, int | None]) -> Scored:
    """Blank answers are wrong. Only the main section counts towards the score."""
    known = {i.item_id for i in items}
    unknown = set(answers) - known
    if unknown:
        raise AssessmentError("unknown_item", "An answer refers to a question not on this test.")
    responses = []
    for item in items:
        chosen = answers.get(item.item_id)
        if chosen is not None and not 0 <= chosen < len(item.options):
            raise AssessmentError("bad_choice", "An answer picks an option that does not exist.")
        responses.append(
            Response(
                item.item_id, item.concept_id, item.section, chosen, chosen == item.answer_index
            )
        )
    main = [r for r in responses if r.section == "main"]
    return Scored(tuple(responses), sum(r.correct for r in main), len(main))


def normalised_gain(pre_pct: float, post_pct: float) -> float | None:
    """Hake's g = (post - pre) / (100 - pre); undefined for a perfect pre-test."""
    if pre_pct >= 100.0:
        return None
    return (post_pct - pre_pct) / (100.0 - pre_pct)


@dataclass(frozen=True)
class GainLine:
    pre_pct: float
    post_pct: float
    gain: float | None


@dataclass(frozen=True)
class GainReport:
    overall: GainLine
    by_topic: dict[str, GainLine]
    by_concept: dict[str, GainLine]


def _pct_by(responses: Iterable[Response], key: Callable[[Response], str]) -> dict[str, float]:
    right: Counter[str] = Counter()
    total: Counter[str] = Counter()
    for r in responses:
        if r.section == "main":
            total[key(r)] += 1
            right[key(r)] += r.correct
    return {k: 100.0 * right[k] / total[k] for k in total}


def _line(pre: float, post: float) -> GainLine:
    return GainLine(pre, post, normalised_gain(pre, post))


def gain_report(
    pre: Sequence[Response], post: Sequence[Response], topic_of: Mapping[str, str]
) -> GainReport:
    """Overall, per topic and per concept; twin items make the two tests comparable."""

    def by(key: Callable[[Response], str]) -> dict[str, GainLine]:
        before, after = _pct_by(pre, key), _pct_by(post, key)
        return {k: _line(before[k], after[k]) for k in sorted(before.keys() & after.keys())}

    overall = by(lambda _: "all").get("all", _line(0.0, 0.0))
    return GainReport(
        overall=overall,
        by_topic=by(lambda r: topic_of.get(r.concept_id, r.concept_id)),
        by_concept=by(lambda r: r.concept_id),
    )


@dataclass(frozen=True)
class GroupSummary:
    learners: int
    mean_pre: float | None
    mean_post: float | None
    mean_gain: float | None  # mean of individual g, learners with pre = 100 left out
    class_gain: float | None  # Hake's <g> from the group means


def summarise_group(lines: Sequence[GainLine]) -> GroupSummary:
    if not lines:
        return GroupSummary(0, None, None, None, None)
    pre = sum(line.pre_pct for line in lines) / len(lines)
    post = sum(line.post_pct for line in lines) / len(lines)
    gains = [line.gain for line in lines if line.gain is not None]
    return GroupSummary(
        learners=len(lines),
        mean_pre=pre,
        mean_post=post,
        mean_gain=sum(gains) / len(gains) if gains else None,
        class_gain=normalised_gain(pre, post),
    )


@dataclass(frozen=True)
class SnapshotValidation:
    """How well mastery at post-test start predicts each post-test answer."""

    answers: int
    learners: int
    correct_rate: float | None
    auc: float | None  # None when every answer was right, or every answer wrong
    brier: float | None
    threshold_accuracy: float | None  # mastered (>= 0.70) vs answered correctly


def predicted_correct(p_mastery: float, params: BktParams) -> float:
    return p_mastery * (1 - params.p_slip) + (1 - p_mastery) * params.p_guess


def auc(scores: Sequence[float], labels: Sequence[bool]) -> float | None:
    """Mann-Whitney AUC with ties counted as half."""
    positives = [s for s, y in zip(scores, labels, strict=True) if y]
    negatives = [s for s, y in zip(scores, labels, strict=True) if not y]
    if not positives or not negatives:
        return None
    ranked = sorted(scores)
    # Average rank of each distinct score (1-based), so ties share their rank.
    first: dict[float, int] = {}
    count: Counter[float] = Counter(ranked)
    for i, s in enumerate(ranked, start=1):
        first.setdefault(s, i)
    rank = {s: first[s] + (count[s] - 1) / 2 for s in count}
    rank_sum = sum(rank[s] for s in positives)
    n_pos, n_neg = len(positives), len(negatives)
    return (rank_sum - n_pos * (n_pos + 1) / 2) / (n_pos * n_neg)


def validate_snapshot(
    pairs: Sequence[tuple[str, float, bool]], params: BktParams
) -> SnapshotValidation:
    """`pairs` = (learner, snapshot mastery of the item's concept, answered correctly)."""
    if not pairs:
        return SnapshotValidation(0, 0, None, None, None, None)
    mastery = [p for _, p, _ in pairs]
    labels = [y for _, _, y in pairs]
    predicted = [predicted_correct(p, params) for p in mastery]
    n = len(pairs)
    return SnapshotValidation(
        answers=n,
        learners=len({learner for learner, _, _ in pairs}),
        correct_rate=sum(labels) / n,
        auc=auc(mastery, labels),
        brier=sum((p - y) ** 2 for p, y in zip(predicted, labels, strict=True)) / n,
        threshold_accuracy=sum(
            (p >= MASTERY_THRESHOLD) == y for p, y in zip(mastery, labels, strict=True)
        )
        / n,
    )


def check_bank(
    papers: Sequence[Paper],
    known_concepts: Iterable[str],
    main_items: int = MAIN_ITEMS_PER_PAPER,
) -> list[str]:
    """Problems that would make an item bank unfit for the study; empty means fine."""
    problems: list[str] = []
    known = set(known_concepts)
    by_module: dict[str, dict[str, Paper]] = defaultdict(dict)
    all_items: dict[str, Item] = {}

    for paper in papers:
        if paper.form in by_module[paper.module_id]:
            problems.append(f"{paper.module_id}: form {paper.form} appears twice")
        by_module[paper.module_id][paper.form] = paper
        positions = [i.position for i in paper.items]
        if len(set(positions)) != len(positions):
            problems.append(f"{paper.paper_id}: two items share a position")
        main = [i for i in paper.items if i.section == "main"]
        if len(main) != main_items:
            problems.append(f"{paper.paper_id}: {len(main)} main items, expected {main_items}")
        for item in paper.items:
            where = f"{paper.paper_id}/{item.item_id}"
            if item.item_id in all_items:
                problems.append(f"{where}: item id used twice")
            all_items[item.item_id] = item
            if item.concept_id not in known:
                problems.append(f"{where}: unknown concept {item.concept_id}")
            if len(item.options) < 2 or len(set(item.options)) != len(item.options):
                problems.append(f"{where}: needs at least 2 distinct options")
            if not 0 <= item.answer_index < len(item.options):
                problems.append(f"{where}: answer_index out of range")

    for module_id, forms in sorted(by_module.items()):
        if set(forms) != {"A", "B"}:
            problems.append(f"{module_id}: needs exactly forms A and B, has {sorted(forms)}")
            continue
        a, b = forms["A"], forms["B"]
        concepts_a = Counter(i.concept_id for i in a.items if i.section == "main")
        concepts_b = Counter(i.concept_id for i in b.items if i.section == "main")
        if concepts_a != concepts_b:
            problems.append(f"{module_id}: forms A and B cover concepts differently")
        for item in (i for i in a.items if i.section == "main"):
            twin = all_items.get(item.twin_item_id or "")
            if twin is None or twin not in b.items:
                problems.append(f"{a.paper_id}/{item.item_id}: twin is missing from form B")
            elif twin.concept_id != item.concept_id or twin.twin_item_id != item.item_id:
                problems.append(f"{a.paper_id}/{item.item_id}: twin does not point back")
    return problems
