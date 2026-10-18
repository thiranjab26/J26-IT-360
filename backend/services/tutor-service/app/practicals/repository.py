"""Where practical tests and attempts are kept. Same shape as the session repository: the
service uses the protocol, the real one writes to the `tutor` schema, tests use an in-memory twin.
"""

from __future__ import annotations

import uuid
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Protocol

from sqlalchemy import delete, func, insert, select
from sqlalchemy.orm import Session

from app.db.tables import practical_attempts, practical_tests
from app.practicals.tests_builder import TestCase


@dataclass(frozen=True)
class Standing:
    """How a student stands on one practical."""

    passed: bool
    best_passed: int
    total: int


class PracticalRepository(Protocol):
    def tests(self, question_id: str) -> list[TestCase]: ...

    def replace_tests(self, question_id: str, tests: Sequence[TestCase]) -> None: ...

    def tested(self) -> set[str]:
        """Question ids that have tests, so the list can say which practicals are ready."""
        ...

    def test_counts(self) -> dict[str, int]:
        """How many tests each question has."""
        ...

    def record_attempt(
        self,
        user_id: str,
        question_id: str,
        source: str,
        compiled: bool,
        passed: bool,
        tests_passed: int,
        tests_total: int,
    ) -> None: ...

    def standings(self, user_id: str) -> dict[str, Standing]: ...

    def last_source(self, user_id: str, question_id: str) -> str | None: ...


class SqlPracticalRepository:
    def __init__(self, db: Session) -> None:
        self.db = db

    def tests(self, question_id: str) -> list[TestCase]:
        rows = self.db.execute(
            select(practical_tests)
            .where(practical_tests.c.question_id == question_id)
            .order_by(practical_tests.c.test_no)
        ).mappings()
        return [TestCase(r["stdin"], r["expected"], r["visible"], r["source"]) for r in rows]

    def replace_tests(self, question_id: str, tests: Sequence[TestCase]) -> None:
        self.db.execute(delete(practical_tests).where(practical_tests.c.question_id == question_id))
        if tests:
            self.db.execute(
                insert(practical_tests),
                [
                    {
                        "question_id": question_id,
                        "test_no": number,
                        "stdin": t.stdin,
                        "expected": t.expected,
                        "visible": t.visible,
                        "source": t.source,
                    }
                    for number, t in enumerate(tests, 1)
                ],
            )

    def tested(self) -> set[str]:
        return {r[0] for r in self.db.execute(select(practical_tests.c.question_id).distinct())}

    def test_counts(self) -> dict[str, int]:
        rows = self.db.execute(
            select(practical_tests.c.question_id, func.count()).group_by(
                practical_tests.c.question_id
            )
        )
        return {q: int(n) for q, n in rows}

    def record_attempt(
        self,
        user_id: str,
        question_id: str,
        source: str,
        compiled: bool,
        passed: bool,
        tests_passed: int,
        tests_total: int,
    ) -> None:
        self.db.execute(
            insert(practical_attempts).values(
                user_id=uuid.UUID(user_id),
                question_id=question_id,
                source=source,
                compiled=compiled,
                passed=passed,
                tests_passed=tests_passed,
                tests_total=tests_total,
                # The real clock, not now(): now() is frozen for a whole transaction, which would
                # leave two attempts made close together with the same time.
                created_at=func.clock_timestamp(),
            )
        )

    def standings(self, user_id: str) -> dict[str, Standing]:
        rows = self.db.execute(
            select(
                practical_attempts.c.question_id,
                func.bool_or(practical_attempts.c.passed),
                func.max(practical_attempts.c.tests_passed),
                func.max(practical_attempts.c.tests_total),
            )
            .where(practical_attempts.c.user_id == uuid.UUID(user_id))
            .group_by(practical_attempts.c.question_id)
        )
        return {q: Standing(bool(p), int(best), int(total)) for q, p, best, total in rows}

    def last_source(self, user_id: str, question_id: str) -> str | None:
        return self.db.execute(
            select(practical_attempts.c.source)
            .where(
                practical_attempts.c.user_id == uuid.UUID(user_id),
                practical_attempts.c.question_id == question_id,
            )
            .order_by(practical_attempts.c.created_at.desc())
            .limit(1)
        ).scalar_one_or_none()
