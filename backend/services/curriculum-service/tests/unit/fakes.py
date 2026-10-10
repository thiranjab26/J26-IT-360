"""In-memory AssessmentRepository with the same rules as AssessmentStore."""

from __future__ import annotations

import itertools
import uuid
from dataclasses import replace
from datetime import UTC, datetime

from app.domain.assessment import (
    CELLS,
    Chooser,
    Enrolment,
    Paper,
    Phase,
    Response,
    Scored,
    TestKind,
)
from app.domain.practice import PracticeItem
from app.domain.study import Attempt, LearnerResults, SnapshotRow


class FakePracticeRepository:
    """In-memory PracticeRepository; tries come from the mastery fake's stub attempts."""

    def __init__(self, items: tuple[PracticeItem, ...], attempts: list) -> None:
        self.by_id = {i.item_id: i for i in items}
        self.retired: set[str] = set()
        self.attempts = attempts  # FakeRepository.attempts: (user, concept, item, correct, hints)
        self.hint_log: list[tuple[uuid.UUID, str]] = []

    def items(self, concept_id: str) -> list[PracticeItem]:
        return [
            i
            for i in self.by_id.values()
            if i.concept_id == concept_id and i.item_id not in self.retired
        ]

    def item(self, item_id: str) -> PracticeItem | None:
        return self.by_id.get(item_id)

    def tries(self, user_id: uuid.UUID, concept_id: str) -> dict[str, int]:
        counts: dict[str, int] = {}
        for user, concept, item_id, _, _ in self.attempts:
            if user == user_id and concept == concept_id:
                counts[item_id] = counts.get(item_id, 0) + 1
        return counts

    def add_hint(self, user_id: uuid.UUID, item_id: str) -> None:
        self.hint_log.append((user_id, item_id))

    def hints(self, user_id: uuid.UUID, item_id: str) -> int:
        return self.hint_log.count((user_id, item_id))


class FakeAssessmentRepository:
    def __init__(self, papers: tuple[Paper, ...] = ()) -> None:
        self.phases: dict[str, Phase] = {}
        self.enrolments: dict[tuple[uuid.UUID, str], Enrolment] = {}
        self.papers = {p.paper_id: p for p in papers}
        self.attempts: dict[tuple[uuid.UUID, str, str], Attempt] = {}
        self.answers: dict[int, tuple[Response, ...]] = {}
        self.snapshots: dict[int, list[SnapshotRow]] = {}
        self._ids = itertools.count(1)

    def phase(self, module_id: str) -> Phase:
        return self.phases.get(module_id, "closed")

    def set_phase(self, module_id: str, phase: Phase, by: uuid.UUID) -> None:
        self.phases[module_id] = phase

    def enrolment(self, user_id: uuid.UUID, module_id: str) -> Enrolment | None:
        return self.enrolments.get((user_id, module_id))

    def enrol(self, user_id: uuid.UUID, module_id: str, choose: Chooser) -> Enrolment:
        if (user_id, module_id) not in self.enrolments:
            counts = {cell: 0 for cell in CELLS}
            for (_, module), e in self.enrolments.items():
                if module == module_id:
                    counts[(e.group, e.form_order)] += 1
            group = next((e.group for (u, _), e in self.enrolments.items() if u == user_id), None)
            self.enrolments[(user_id, module_id)] = choose(counts, group)
        return self.enrolments[(user_id, module_id)]

    def paper(self, paper_id: str) -> Paper | None:
        return self.papers.get(paper_id)

    def paper_for(self, module_id: str, form: str) -> Paper | None:
        return next(
            (p for p in self.papers.values() if p.module_id == module_id and p.form == form), None
        )

    def attempt(self, user_id: uuid.UUID, module_id: str, kind: TestKind) -> Attempt | None:
        return self.attempts.get((user_id, module_id, kind))

    def start_attempt(
        self,
        user_id: uuid.UUID,
        module_id: str,
        kind: TestKind,
        paper_id: str,
        snapshot: list[SnapshotRow],
        params_version: str,
    ) -> Attempt:
        key = (user_id, module_id, kind)
        if key not in self.attempts:
            attempt = Attempt(
                next(self._ids), user_id, module_id, kind, paper_id, datetime.now(UTC)
            )
            self.attempts[key] = attempt
            self.snapshots[attempt.attempt_id] = snapshot
        return self.attempts[key]

    def finish_attempt(self, attempt_id: int, scored: Scored) -> tuple[Attempt, bool]:
        key, attempt = next((k, a) for k, a in self.attempts.items() if a.attempt_id == attempt_id)
        if attempt.submitted:
            return attempt, False
        self.attempts[key] = replace(
            attempt,
            submitted_at=datetime.now(UTC),
            main_correct=scored.main_correct,
            main_total=scored.main_total,
            score_pct=scored.score_pct,
        )
        self.answers[attempt_id] = scored.responses
        return self.attempts[key], True

    def responses(self, attempt_id: int) -> tuple[Response, ...]:
        return self.answers.get(attempt_id, ())

    def module_results(self, module_id: str) -> list[LearnerResults]:
        def answers(user_id: uuid.UUID, kind: str) -> tuple[Response, ...] | None:
            attempt = self.attempts.get((user_id, module_id, kind))
            return self.answers[attempt.attempt_id] if attempt and attempt.submitted else None

        return [
            LearnerResults(user_id, e, answers(user_id, "pretest"), answers(user_id, "posttest"))
            for (user_id, module), e in self.enrolments.items()
            if module == module_id
        ]

    def snapshot_pairs(self, module_id: str) -> list[tuple[str, float, bool]]:
        pairs = []
        for (user_id, module, kind), attempt in self.attempts.items():
            if module != module_id or kind != "posttest" or not attempt.submitted:
                continue
            mastery = {s.concept_id: s.p_mastery for s in self.snapshots[attempt.attempt_id]}
            pairs += [
                (str(user_id), mastery[r.concept_id], r.correct)
                for r in self.answers[attempt.attempt_id]
                if r.section == "main" and r.chosen_index is not None
            ]
        return pairs
