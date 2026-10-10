"""Postgres storage for the study window, enrolment, test papers and attempts."""

from __future__ import annotations

import json
import uuid
from collections.abc import Mapping
from typing import Any

from sqlalchemy import text
from sqlalchemy.engine import Connection, Engine

from app.domain.assessment import (
    CELLS,
    Chooser,
    Enrolment,
    Item,
    Paper,
    Phase,
    Response,
    Scored,
    TestKind,
)
from app.domain.study import Attempt, LearnerResults, SnapshotRow

_ATTEMPT_COLUMNS = (
    "attempt_id, user_id, module_id, kind, paper_id, started_at, submitted_at,"
    " main_correct, main_total, score_pct"
)


def _attempt(row: Mapping[str, Any]) -> Attempt:
    return Attempt(**{**row, "user_id": uuid.UUID(str(row["user_id"]))})


class AssessmentStore:
    def __init__(self, engine: Engine) -> None:
        self._engine = engine

    def phase(self, module_id: str) -> Phase:
        with self._engine.connect() as connection:
            phase = connection.execute(
                text("SELECT phase FROM curriculum.study_window WHERE module_id = :module_id"),
                {"module_id": module_id},
            ).scalar()
        return phase or "closed"

    def set_phase(self, module_id: str, phase: Phase, by: uuid.UUID) -> None:
        with self._engine.begin() as connection:
            connection.execute(
                text(
                    """
                    INSERT INTO curriculum.study_window (module_id, phase, updated_by, updated_at)
                    VALUES (:module_id, :phase, :by, now())
                    ON CONFLICT (module_id) DO UPDATE
                    SET phase = EXCLUDED.phase, updated_by = EXCLUDED.updated_by,
                        updated_at = EXCLUDED.updated_at
                    """
                ),
                {"module_id": module_id, "phase": phase, "by": by},
            )

    def enrolment(self, user_id: uuid.UUID, module_id: str) -> Enrolment | None:
        with self._engine.connect() as connection:
            return self._enrolment(connection, user_id, module_id)

    def enrol(self, user_id: uuid.UUID, module_id: str, choose: Chooser) -> Enrolment:
        with self._engine.begin() as connection:
            # Learner lock first, then module lock (always this order, so no deadlock):
            # one learner cannot get two groups, and two learners cannot both see the
            # same counts and fill the same cell.
            for key in (
                f"curriculum.enrolment.user:{user_id}",
                f"curriculum.enrolment:{module_id}",
            ):
                connection.execute(
                    text("SELECT pg_advisory_xact_lock(hashtextextended(:key, 0))"), {"key": key}
                )
            existing = self._enrolment(connection, user_id, module_id)
            if existing is not None:
                return existing
            group = connection.execute(
                text(
                    "SELECT study_group FROM curriculum.enrolment WHERE user_id = :user_id LIMIT 1"
                ),
                {"user_id": user_id},
            ).scalar()
            counts = {cell: 0 for cell in CELLS}
            for row in connection.execute(
                text(
                    "SELECT study_group, form_order, count(*) AS n FROM curriculum.enrolment"
                    " WHERE module_id = :module_id GROUP BY study_group, form_order"
                ),
                {"module_id": module_id},
            ).mappings():
                counts[(row["study_group"], row["form_order"])] = row["n"]
            enrolment = choose(counts, group)
            connection.execute(
                text(
                    "INSERT INTO curriculum.enrolment (user_id, module_id, study_group, form_order)"
                    " VALUES (:user_id, :module_id, :group, :order)"
                ),
                {
                    "user_id": user_id,
                    "module_id": module_id,
                    "group": enrolment.group,
                    "order": enrolment.form_order,
                },
            )
            return enrolment

    def paper(self, paper_id: str) -> Paper | None:
        return self._paper("p.paper_id = :key", paper_id)

    def paper_for(self, module_id: str, form: str) -> Paper | None:
        return self._paper("p.module_id = :key AND p.form = :form", module_id, form)

    def attempt(self, user_id: uuid.UUID, module_id: str, kind: TestKind) -> Attempt | None:
        with self._engine.connect() as connection:
            row = (
                connection.execute(
                    text(
                        f"SELECT {_ATTEMPT_COLUMNS} FROM curriculum.test_attempt"
                        " WHERE user_id = :user_id AND module_id = :module_id AND kind = :kind"
                    ),
                    {"user_id": user_id, "module_id": module_id, "kind": kind},
                )
                .mappings()
                .first()
            )
        return _attempt(row) if row else None

    def start_attempt(
        self,
        user_id: uuid.UUID,
        module_id: str,
        kind: TestKind,
        paper_id: str,
        snapshot: list[SnapshotRow],
        params_version: str,
    ) -> Attempt:
        with self._engine.begin() as connection:
            created = connection.execute(
                text(
                    """
                    INSERT INTO curriculum.test_attempt (user_id, module_id, kind, paper_id)
                    VALUES (:user_id, :module_id, :kind, :paper_id)
                    ON CONFLICT (user_id, module_id, kind) DO NOTHING
                    RETURNING attempt_id
                    """
                ),
                {"user_id": user_id, "module_id": module_id, "kind": kind, "paper_id": paper_id},
            ).scalar()
            if created is not None and snapshot:
                connection.execute(
                    text(
                        """
                        INSERT INTO curriculum.mastery_snapshot
                            (attempt_id, concept_id, p_mastery, evidence_count, params_version)
                        VALUES (:attempt_id, :concept_id, :p, :n, :params_version)
                        """
                    ),
                    [
                        {
                            "attempt_id": created,
                            "concept_id": s.concept_id,
                            "p": s.p_mastery,
                            "n": s.evidence_count,
                            "params_version": params_version,
                        }
                        for s in snapshot
                    ],
                )
            row = (
                connection.execute(
                    text(
                        f"SELECT {_ATTEMPT_COLUMNS} FROM curriculum.test_attempt"
                        " WHERE user_id = :user_id AND module_id = :module_id AND kind = :kind"
                    ),
                    {"user_id": user_id, "module_id": module_id, "kind": kind},
                )
                .mappings()
                .one()
            )
        return _attempt(row)

    def finish_attempt(self, attempt_id: int, scored: Scored) -> tuple[Attempt, bool]:
        with self._engine.begin() as connection:
            # The WHERE makes a second, concurrent submit a no-op.
            submitted = connection.execute(
                text(
                    """
                    UPDATE curriculum.test_attempt
                    SET submitted_at = now(), main_correct = :correct, main_total = :total,
                        score_pct = :pct
                    WHERE attempt_id = :attempt_id AND submitted_at IS NULL
                    RETURNING attempt_id
                    """
                ),
                {
                    "attempt_id": attempt_id,
                    "correct": scored.main_correct,
                    "total": scored.main_total,
                    "pct": scored.score_pct,
                },
            ).scalar()
            if submitted is not None:
                connection.execute(
                    text(
                        """
                        INSERT INTO curriculum.test_response
                            (attempt_id, item_id, chosen_index, correct)
                        VALUES (:attempt_id, :item_id, :chosen, :correct)
                        """
                    ),
                    [
                        {
                            "attempt_id": attempt_id,
                            "item_id": r.item_id,
                            "chosen": r.chosen_index,
                            "correct": r.correct,
                        }
                        for r in scored.responses
                    ],
                )
            row = (
                connection.execute(
                    text(
                        f"SELECT {_ATTEMPT_COLUMNS} FROM curriculum.test_attempt"
                        " WHERE attempt_id = :attempt_id"
                    ),
                    {"attempt_id": attempt_id},
                )
                .mappings()
                .one()
            )
        return _attempt(row), submitted is not None

    def responses(self, attempt_id: int) -> tuple[Response, ...]:
        with self._engine.connect() as connection:
            return self._responses(connection, [attempt_id]).get(attempt_id, ())

    def module_results(self, module_id: str) -> list[LearnerResults]:
        with self._engine.connect() as connection:
            enrolments = (
                connection.execute(
                    text(
                        "SELECT user_id, study_group, form_order FROM curriculum.enrolment"
                        " WHERE module_id = :module_id ORDER BY enrolled_at, user_id"
                    ),
                    {"module_id": module_id},
                )
                .mappings()
                .all()
            )
            attempts = (
                connection.execute(
                    text(
                        "SELECT attempt_id, user_id, kind FROM curriculum.test_attempt"
                        " WHERE module_id = :module_id AND submitted_at IS NOT NULL"
                    ),
                    {"module_id": module_id},
                )
                .mappings()
                .all()
            )
            responses = self._responses(connection, [a["attempt_id"] for a in attempts])
        by_learner = {(str(a["user_id"]), a["kind"]): a["attempt_id"] for a in attempts}

        def answers(user_id: str, kind: str) -> tuple[Response, ...] | None:
            attempt_id = by_learner.get((user_id, kind))
            return None if attempt_id is None else responses.get(attempt_id, ())

        return [
            LearnerResults(
                user_id=uuid.UUID(str(e["user_id"])),
                enrolment=Enrolment(e["study_group"], e["form_order"]),
                pre=answers(str(e["user_id"]), "pretest"),
                post=answers(str(e["user_id"]), "posttest"),
            )
            for e in enrolments
        ]

    def snapshot_pairs(self, module_id: str) -> list[tuple[str, float, bool]]:
        with self._engine.connect() as connection:
            rows = connection.execute(
                text(
                    """
                    SELECT a.user_id::text AS user_id, s.p_mastery, r.correct
                    FROM curriculum.test_attempt AS a
                    JOIN curriculum.test_response AS r ON r.attempt_id = a.attempt_id
                    JOIN curriculum.test_item AS i ON i.item_id = r.item_id
                    JOIN curriculum.mastery_snapshot AS s
                         ON s.attempt_id = a.attempt_id AND s.concept_id = i.concept_id
                    WHERE a.module_id = :module_id AND a.kind = 'posttest'
                      AND a.submitted_at IS NOT NULL
                      AND i.section = 'main' AND r.chosen_index IS NOT NULL
                    ORDER BY a.attempt_id, i.position
                    """
                ),
                {"module_id": module_id},
            ).all()
        return [(user, float(p), bool(correct)) for user, p, correct in rows]

    def _paper(self, where: str, key: str, form: str | None = None) -> Paper | None:
        # `where` is one of the two literals above, never input.
        with self._engine.connect() as connection:
            rows = (
                connection.execute(
                    text(
                        f"""
                        SELECT p.paper_id, p.module_id, p.form, p.title,
                               i.item_id, i.position, i.concept_id, i.section, i.stem,
                               i.options, i.answer_index, i.twin_item_id
                        FROM curriculum.test_paper AS p
                        JOIN curriculum.test_item AS i ON i.paper_id = p.paper_id
                        WHERE {where}
                        ORDER BY i.position
                        """
                    ),
                    {"key": key, "form": form},
                )
                .mappings()
                .all()
            )
        if not rows:
            return None
        first = rows[0]
        return Paper(
            paper_id=first["paper_id"],
            module_id=first["module_id"],
            form=first["form"],
            title=first["title"],
            items=tuple(
                Item(
                    item_id=r["item_id"],
                    position=r["position"],
                    concept_id=r["concept_id"],
                    section=r["section"],
                    stem=r["stem"],
                    options=tuple(r["options"]),
                    answer_index=r["answer_index"],
                    twin_item_id=r["twin_item_id"],
                )
                for r in rows
            ),
        )

    @staticmethod
    def _enrolment(connection: Connection, user_id: uuid.UUID, module_id: str) -> Enrolment | None:
        row = connection.execute(
            text(
                "SELECT study_group, form_order FROM curriculum.enrolment"
                " WHERE user_id = :user_id AND module_id = :module_id"
            ),
            {"user_id": user_id, "module_id": module_id},
        ).first()
        return Enrolment(row[0], row[1]) if row else None

    @staticmethod
    def _responses(
        connection: Connection, attempt_ids: list[int]
    ) -> dict[int, tuple[Response, ...]]:
        if not attempt_ids:
            return {}
        grouped: dict[int, list[Response]] = {}
        for r in connection.execute(
            text(
                """
                SELECT r.attempt_id, r.item_id, i.concept_id, i.section, r.chosen_index, r.correct
                FROM curriculum.test_response AS r
                JOIN curriculum.test_item AS i ON i.item_id = r.item_id
                WHERE r.attempt_id = ANY(:ids)
                ORDER BY r.attempt_id, i.position
                """
            ),
            {"ids": attempt_ids},
        ).mappings():
            grouped.setdefault(r["attempt_id"], []).append(
                Response(
                    r["item_id"], r["concept_id"], r["section"], r["chosen_index"], r["correct"]
                )
            )
        return {k: tuple(v) for k, v in grouped.items()}


def paper_rows(paper: Paper, bank_version: str) -> tuple[dict, list[dict]]:
    """Rows for test_paper and test_item, used by scripts/import_tests.py."""
    return (
        {
            "paper_id": paper.paper_id,
            "module_id": paper.module_id,
            "form": paper.form,
            "title": paper.title,
            "bank_version": bank_version,
        },
        [
            {
                "item_id": i.item_id,
                "paper_id": paper.paper_id,
                "position": i.position,
                "concept_id": i.concept_id,
                "section": i.section,
                "stem": i.stem,
                "options": json.dumps(list(i.options)),
                "answer_index": i.answer_index,
                "twin_item_id": i.twin_item_id,
            }
            for i in paper.items
        ],
    )
