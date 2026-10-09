"""The pre/post study: window, enrolment, one attempt per test, snapshot, gain (FR-12 to FR-14)."""

from __future__ import annotations

import uuid
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from datetime import datetime
from typing import Protocol

from app.domain.assessment import (
    AssessmentError,
    Enrolment,
    GainLine,
    GainReport,
    Group,
    GroupSummary,
    Item,
    Paper,
    Phase,
    Response,
    Scored,
    SnapshotValidation,
    TestKind,
    choose_cell,
    form_for,
    gain_report,
    open_test,
    score,
    summarise_group,
    validate_snapshot,
)
from app.domain.learner import Learner
from app.domain.mastery import Observation


@dataclass(frozen=True)
class Attempt:
    attempt_id: int
    user_id: uuid.UUID
    module_id: str
    kind: TestKind
    paper_id: str
    started_at: datetime
    submitted_at: datetime | None = None
    main_correct: int | None = None
    main_total: int | None = None
    score_pct: float | None = None

    @property
    def submitted(self) -> bool:
        return self.submitted_at is not None


@dataclass(frozen=True)
class SnapshotRow:
    concept_id: str
    p_mastery: float
    evidence_count: int


@dataclass(frozen=True)
class LearnerResults:
    user_id: uuid.UUID
    enrolment: Enrolment
    pre: tuple[Response, ...] | None  # None until submitted
    post: tuple[Response, ...] | None


class AssessmentRepository(Protocol):
    def phase(self, module_id: str) -> Phase: ...

    def set_phase(self, module_id: str, phase: Phase, by: uuid.UUID) -> None: ...

    def enrolment(self, user_id: uuid.UUID, module_id: str) -> Enrolment | None: ...

    def enrol(
        self,
        user_id: uuid.UUID,
        module_id: str,
        choose: Callable[[Mapping[tuple[str, str], int]], Enrolment],
    ) -> Enrolment:
        """Idempotent; `choose` sees the current cell counts under a per-module lock."""
        ...

    def paper(self, paper_id: str) -> Paper | None: ...

    def paper_for(self, module_id: str, form: str) -> Paper | None: ...

    def attempt(self, user_id: uuid.UUID, module_id: str, kind: TestKind) -> Attempt | None: ...

    def start_attempt(
        self,
        user_id: uuid.UUID,
        module_id: str,
        kind: TestKind,
        paper_id: str,
        snapshot: list[SnapshotRow],
        params_version: str,
    ) -> Attempt:
        """Idempotent; the snapshot is written only with a new attempt."""
        ...

    def finish_attempt(self, attempt_id: int, scored: Scored) -> tuple[Attempt, bool]:
        """Marks it submitted once; returns (attempt, whether this call submitted it)."""
        ...

    def responses(self, attempt_id: int) -> tuple[Response, ...]: ...

    def module_results(self, module_id: str) -> list[LearnerResults]: ...

    def snapshot_pairs(self, module_id: str) -> list[tuple[str, float, bool]]:
        """(learner, snapshot mastery, correct) per answered main post-test item."""
        ...


@dataclass(frozen=True)
class TestStatus:
    phase: Phase
    open_test: TestKind | None
    pretest: Attempt | None
    posttest: Attempt | None


@dataclass(frozen=True)
class CohortRow:
    user_id: uuid.UUID
    group: Group
    form_order: str
    line: GainLine


@dataclass(frozen=True)
class CohortGain:
    enrolled: int
    pretest_done: int
    posttest_done: int
    rows: tuple[CohortRow, ...]
    groups: dict[str, GroupSummary]


class Study:
    def __init__(
        self,
        repository: AssessmentRepository,
        learner: Learner,
        choose: Callable[[Mapping[tuple[str, str], int]], Enrolment] = choose_cell,
    ) -> None:
        self.repository = repository
        self.learner = learner
        self._choose = choose

    def window(self, module_id: str) -> Phase:
        return self.repository.phase(module_id)

    def set_window(self, module_id: str, phase: Phase, by: uuid.UUID) -> None:
        self.repository.set_phase(module_id, phase, by)

    def group_of(self, user_id: uuid.UUID, module_id: str) -> Group | None:
        enrolment = self.repository.enrolment(user_id, module_id)
        return enrolment.group if enrolment else None

    def status(self, user_id: uuid.UUID, module_id: str) -> TestStatus:
        phase = self.repository.phase(module_id)
        return TestStatus(
            phase=phase,
            open_test=open_test(phase),
            pretest=self.repository.attempt(user_id, module_id, "pretest"),
            posttest=self.repository.attempt(user_id, module_id, "posttest"),
        )

    def start(
        self, user_id: uuid.UUID, module_id: str, kind: TestKind
    ) -> tuple[Attempt, tuple[Item, ...]]:
        """Starts the test, or resumes an unsubmitted one with the same paper."""
        self._require_open(module_id, kind)
        existing = self.repository.attempt(user_id, module_id, kind)
        if existing is not None and existing.submitted:
            raise AssessmentError("already_submitted", "You have already taken this test.")

        if kind == "pretest":
            enrolment = self.repository.enrol(user_id, module_id, self._choose)
        else:
            enrolment = self.repository.enrolment(user_id, module_id)
            pre = self.repository.attempt(user_id, module_id, "pretest")
            if enrolment is None or pre is None or not pre.submitted:
                raise AssessmentError(
                    "pretest_required", "Only learners who took the pre-test take the post-test."
                )

        paper = self.repository.paper_for(module_id, form_for(enrolment.form_order, kind))
        if paper is None:
            raise AssessmentError("no_paper", "This test has not been set up yet.")
        items = paper.items_for(kind)
        if existing is not None:
            return existing, items

        snapshot: list[SnapshotRow] = []
        if kind == "posttest":
            # Freeze what the model believed before any post-test answer is seen.
            records = self.learner.mastery(user_id)
            for concept_id in sorted({i.concept_id for i in items}):
                record = records.get(concept_id)
                snapshot.append(
                    SnapshotRow(
                        concept_id,
                        record.score if record else self.learner.params.p_init,
                        record.evidence_count if record else 0,
                    )
                )
        attempt = self.repository.start_attempt(
            user_id, module_id, kind, paper.paper_id, snapshot, self.learner.params_version
        )
        return attempt, items

    def submit(
        self,
        user_id: uuid.UUID,
        module_id: str,
        kind: TestKind,
        answers: Mapping[str, int | None],
    ) -> tuple[Attempt, bool]:
        """Scores once; a repeated submit returns the stored result. Returns (attempt, repeat)."""
        attempt = self.repository.attempt(user_id, module_id, kind)
        if attempt is None:
            raise AssessmentError("not_started", "Start the test before submitting it.")
        if not attempt.submitted:
            self._require_open(module_id, kind)
            paper = self.repository.paper(attempt.paper_id)
            if paper is None:
                raise AssessmentError("no_paper", "This test has not been set up yet.")
            attempt, newly = self.repository.finish_attempt(
                attempt.attempt_id, score(paper.items_for(kind), answers)
            )
        else:
            newly = False
        # Also on a repeat: evidence is idempotent, so this repairs a submit that
        # was stored but crashed before its answers reached BKT.
        self._record_evidence(attempt)
        return attempt, not newly

    def gain(self, user_id: uuid.UUID, module_id: str, topic_of: Mapping[str, str]) -> GainReport:
        pre = self.repository.attempt(user_id, module_id, "pretest")
        post = self.repository.attempt(user_id, module_id, "posttest")
        if pre is None or post is None or not (pre.submitted and post.submitted):
            raise AssessmentError("no_gain_yet", "Gain needs both a pre-test and a post-test.")
        return gain_report(
            self.repository.responses(pre.attempt_id),
            self.repository.responses(post.attempt_id),
            topic_of,
        )

    def cohort(self, module_id: str, topic_of: Mapping[str, str]) -> CohortGain:
        results = self.repository.module_results(module_id)
        rows = tuple(
            CohortRow(
                r.user_id,
                r.enrolment.group,
                r.enrolment.form_order,
                gain_report(r.pre, r.post, topic_of).overall,
            )
            for r in results
            if r.pre is not None and r.post is not None
        )
        groups = {
            group: summarise_group([row.line for row in rows if row.group == group])
            for group in ("adaptive", "comparison")
        }
        return CohortGain(
            enrolled=len(results),
            pretest_done=sum(r.pre is not None for r in results),
            posttest_done=sum(r.post is not None for r in results),
            rows=rows,
            groups=groups,
        )

    def snapshot_validation(self, module_id: str) -> SnapshotValidation:
        return validate_snapshot(self.repository.snapshot_pairs(module_id), self.learner.params)

    def _require_open(self, module_id: str, kind: TestKind) -> None:
        if open_test(self.repository.phase(module_id)) != kind:
            raise AssessmentError("test_closed", "This test is not open right now.")

    def _record_evidence(self, attempt: Attempt) -> None:
        """Answered items become BKT evidence; blanks are not evidence of anything."""
        assert attempt.submitted_at is not None
        observations = [
            Observation(
                concept_id=r.concept_id,
                item_id=r.item_id,
                source=attempt.kind,
                source_ref=f"{attempt.attempt_id}|{r.item_id}",
                correct_raw=r.correct,
                hints_used=0,
                observed_at=attempt.submitted_at,
            )
            for r in self.repository.responses(attempt.attempt_id)
            if r.chosen_index is not None
        ]
        if observations:
            self.learner.record(attempt.user_id, observations)
