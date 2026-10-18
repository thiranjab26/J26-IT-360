"""Fakes for testing practicals without a database or a JDK."""

from __future__ import annotations

from collections.abc import Callable, Sequence

from app.practicals.repository import Standing
from app.practicals.runner import Batch, RunResult
from app.practicals.tests_builder import TestCase


class InMemoryPracticalRepository:
    def __init__(self) -> None:
        self.by_question: dict[str, list[TestCase]] = {}
        self.attempts: list[tuple[str, str, str, bool, bool, int, int]] = []

    def tests(self, question_id: str) -> list[TestCase]:
        return list(self.by_question.get(question_id, []))

    def replace_tests(self, question_id: str, tests: Sequence[TestCase]) -> None:
        self.by_question[question_id] = list(tests)

    def tested(self) -> set[str]:
        return {q for q, tests in self.by_question.items() if tests}

    def test_counts(self) -> dict[str, int]:
        return {q: len(tests) for q, tests in self.by_question.items() if tests}

    def record_attempt(
        self, user_id, question_id, source, compiled, passed, tests_passed, tests_total
    ) -> None:
        self.attempts.append(
            (user_id, question_id, source, compiled, passed, tests_passed, tests_total)
        )

    def standings(self, user_id: str) -> dict[str, Standing]:
        out: dict[str, Standing] = {}
        for user, question, _, _, passed, got, total in self.attempts:
            if user != user_id:
                continue
            old = out.get(question)
            out[question] = Standing(
                passed=bool(old and old.passed) or passed,
                best_passed=max(old.best_passed if old else 0, got),
                total=max(old.total if old else 0, total),
            )
        return out

    def last_source(self, user_id: str, question_id: str) -> str | None:
        mine = [a for a in self.attempts if a[0] == user_id and a[1] == question_id]
        return mine[-1][2] if mine else None


class FakeRunner:
    """Runs no Java. The program is a Python function from stdin to stdout, chosen by the
    marker the source contains, so a test can ask for a crash, a timeout or a compile error."""

    def __init__(self, program: Callable[[str], str] = lambda stdin: stdin.upper()) -> None:
        self.program = program
        self.calls = 0

    def run_batch(self, source: str, stdins: Sequence[str]) -> Batch:
        self.calls += 1
        if "COMPILE_ERROR" in source:
            return Batch(False, "Main.java:1: error: ';' expected")
        runs = []
        for stdin in stdins:
            if "CRASH" in source:
                runs.append(RunResult("runtime_error", "", "Exception in thread main", 1, 5))
            elif "LOOP" in source:
                runs.append(RunResult("timeout", "", "", None, 5000))
            else:
                runs.append(RunResult("ok", self.program(stdin), "", 0, 12))
        return Batch(True, "", tuple(runs))


class InMemoryAssessmentStore:
    """The lecturer-made practicals, kept in a dict. Enforces the one rule the database does:
    at most one approved item per slot."""

    def __init__(self) -> None:
        self.items: dict[str, object] = {}

    def all(self):
        return list(self.items.values())

    def get(self, question_id):
        return self.items.get(question_id)

    def add(self, item) -> None:
        assert item.question_id not in self.items, "question ids are unique"
        self.items[item.question_id] = item
        self._check_slots()

    def change(self, question_id, **fields) -> None:
        from dataclasses import replace

        self.items[question_id] = replace(self.items[question_id], **fields)
        self._check_slots()

    def _check_slots(self) -> None:
        approved = [i.slot_id for i in self.items.values() if i.status == "approved"]
        assert len(approved) == len(set(approved)), "two approved items share a slot"


class InMemoryJobStore:
    def __init__(self) -> None:
        self.jobs: dict[str, object] = {}

    def create(self, job) -> None:
        from dataclasses import replace
        from datetime import UTC, datetime

        self.jobs[job.job_id] = replace(job, created_at=datetime.now(UTC))

    def get(self, job_id):
        return self.jobs.get(job_id)

    def recent(self, limit: int = 10):
        return list(self.jobs.values())[-limit:]

    def change(self, job_id, **fields) -> None:
        from dataclasses import replace

        self.jobs[job_id] = replace(self.jobs[job_id], **fields)
