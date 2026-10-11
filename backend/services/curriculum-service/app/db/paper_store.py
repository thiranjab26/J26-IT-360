"""Postgres storage for lecturer-edited test papers (curriculum.test_paper / test_item)."""

from __future__ import annotations

import uuid

from sqlalchemy import text
from sqlalchemy.engine import Connection, Engine

from app.db.assessment_store import paper_rows
from app.domain.assessment import AssessmentError, Item, Paper
from app.domain.papers import Changes, PaperVersion, Plan


class PaperStore:
    def __init__(self, engine: Engine) -> None:
        self._engine = engine

    def read(self, module_id: str) -> list[PaperVersion]:
        with self._engine.connect() as connection:
            return self._read(connection, module_id)

    def module_of(self, paper_id: str) -> str | None:
        with self._engine.connect() as connection:
            return connection.execute(
                text("SELECT module_id FROM curriculum.test_paper WHERE paper_id = :paper_id"),
                {"paper_id": paper_id},
            ).scalar()

    def write(self, module_id: str, plan: Plan, by: uuid.UUID) -> Changes:
        with self._engine.begin() as connection:
            # Every paper write in a module takes this lock, so plans see a stable state.
            connection.execute(
                text("SELECT pg_advisory_xact_lock(hashtextextended(:key, 0))"),
                {"key": f"curriculum.papers:{module_id}"},
            )
            changes = plan(self._read(connection, module_id))
            for version in changes.save:
                self._save(connection, version, by)
            if changes.discard:
                connection.execute(
                    text(
                        "DELETE FROM curriculum.test_paper"
                        " WHERE paper_id = ANY(:ids) AND status = 'draft'"
                    ),
                    {"ids": list(changes.discard)},
                )
            if changes.publish:
                connection.execute(
                    text(
                        "UPDATE curriculum.test_paper"
                        " SET status = 'published', published_at = now(), updated_by = :by,"
                        "     updated_at = now()"
                        " WHERE paper_id = ANY(:ids) AND status = 'draft'"
                    ),
                    {"ids": list(changes.publish), "by": by},
                )
        return changes

    @staticmethod
    def _save(connection: Connection, version: PaperVersion, by: uuid.UUID) -> None:
        paper_row, item_rows = paper_rows(version.paper, "editor")
        saved = connection.execute(
            text(
                """
                INSERT INTO curriculum.test_paper
                    (paper_id, module_id, form, title, bank_version, version, status,
                     updated_by, updated_at)
                VALUES (:paper_id, :module_id, :form, :title, :bank_version, :version, 'draft',
                        :by, now())
                ON CONFLICT (paper_id) DO UPDATE
                SET title = EXCLUDED.title, updated_by = EXCLUDED.updated_by,
                    updated_at = EXCLUDED.updated_at
                WHERE curriculum.test_paper.status = 'draft'
                RETURNING paper_id
                """
            ),
            {**paper_row, "version": version.version, "by": by},
        ).scalar()
        if saved is None:  # the domain only saves drafts; this guards the database too
            raise AssessmentError("not_draft", "Only a draft paper can change.")
        connection.execute(
            text("DELETE FROM curriculum.test_item WHERE paper_id = :paper_id"),
            {"paper_id": version.paper_id},
        )
        if item_rows:
            connection.execute(
                text(
                    """
                    INSERT INTO curriculum.test_item
                        (item_id, paper_id, position, concept_id, section, stem, options,
                         answer_index, twin_item_id)
                    VALUES (:item_id, :paper_id, :position, :concept_id, :section, :stem,
                            CAST(:options AS jsonb), :answer_index, :twin_item_id)
                    """
                ),
                item_rows,
            )

    @staticmethod
    def _read(connection: Connection, module_id: str) -> list[PaperVersion]:
        rows = (
            connection.execute(
                text(
                    """
                    SELECT p.paper_id, p.module_id, p.form, p.title, p.version, p.status,
                           p.published_at, p.locked_at,
                           i.item_id, i.position, i.concept_id, i.section, i.stem,
                           i.options, i.answer_index, i.twin_item_id
                    FROM curriculum.test_paper AS p
                    LEFT JOIN curriculum.test_item AS i ON i.paper_id = p.paper_id
                    WHERE p.module_id = :module_id
                    ORDER BY p.form, p.version, i.position
                    """
                ),
                {"module_id": module_id},
            )
            .mappings()
            .all()
        )
        papers: dict[str, tuple[dict, list[Item]]] = {}
        for r in rows:
            _, items = papers.setdefault(r["paper_id"], (dict(r), []))
            if r["item_id"] is not None:
                items.append(
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
                )
        return [
            PaperVersion(
                paper=Paper(p["paper_id"], p["module_id"], p["form"], p["title"], tuple(items)),
                version=p["version"],
                status=p["status"],
                published_at=p["published_at"],
                locked_at=p["locked_at"],
            )
            for p, items in papers.values()
        ]
