"""Aggregates for the lecturer view: counts and averages only, never per-learner rows."""

from __future__ import annotations

from sqlalchemy import text
from sqlalchemy.engine import Engine

from app.domain.cohort import ConceptStat, StudyCounts


class CohortStore:
    def __init__(self, engine: Engine) -> None:
        self._engine = engine

    def concept_stats(self, concept_ids: list[str], threshold: float) -> dict[str, ConceptStat]:
        with self._engine.connect() as connection:
            rows = connection.execute(
                text(
                    """
                    SELECT concept_id, count(*) AS learners,
                           count(*) FILTER (WHERE p_mastery >= :threshold) AS mastered,
                           avg(p_mastery) AS mean_mastery
                    FROM curriculum.concept_mastery
                    WHERE concept_id = ANY(:ids)
                    GROUP BY concept_id
                    """
                ),
                {"ids": concept_ids, "threshold": threshold},
            ).mappings()
            return {
                r["concept_id"]: ConceptStat(
                    int(r["learners"]), int(r["mastered"]), float(r["mean_mastery"])
                )
                for r in rows
            }

    def learners(self, concept_ids: list[str]) -> int:
        with self._engine.connect() as connection:
            return int(
                connection.execute(
                    text(
                        "SELECT count(DISTINCT user_id) FROM curriculum.concept_mastery"
                        " WHERE concept_id = ANY(:ids)"
                    ),
                    {"ids": concept_ids},
                ).scalar()
            )

    def study_counts(self, module_id: str) -> StudyCounts:
        with self._engine.connect() as connection:
            groups = dict(
                connection.execute(
                    text(
                        "SELECT study_group, count(*) FROM curriculum.enrolment"
                        " WHERE module_id = :module_id GROUP BY study_group"
                    ),
                    {"module_id": module_id},
                ).all()
            )
            done = dict(
                connection.execute(
                    text(
                        "SELECT kind, count(*) FROM curriculum.test_attempt"
                        " WHERE module_id = :module_id AND submitted_at IS NOT NULL GROUP BY kind"
                    ),
                    {"module_id": module_id},
                ).all()
            )
        return StudyCounts(
            groups={g: int(groups.get(g, 0)) for g in ("adaptive", "comparison")},
            pretest_done=int(done.get("pretest", 0)),
            posttest_done=int(done.get("posttest", 0)),
        )
