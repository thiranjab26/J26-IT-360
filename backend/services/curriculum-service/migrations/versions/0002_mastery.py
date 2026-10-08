"""curriculum: stub attempts, BKT evidence and mastery, recommendations, contract views

Revision ID: 0002_mastery
Revises: 0001_graph
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0002_mastery"
down_revision: str | None = "0001_graph"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

SCHEMA = "curriculum"
NOW = sa.text("now()")


def upgrade() -> None:
    # C3 stand-in: exactly the columns of tutor.v_attempt_outcomes, append only.
    op.create_table(
        "stub_attempt_outcomes",
        sa.Column("attempt_id", sa.BigInteger(), sa.Identity(), primary_key=True),
        sa.Column("user_id", postgresql.UUID(), nullable=False),
        sa.Column("concept_id", sa.Text(), nullable=False),
        sa.Column("item_id", sa.Text(), nullable=False),
        sa.Column("correct", sa.Boolean(), nullable=False),
        sa.Column("hints_used", sa.SmallInteger(), nullable=False, server_default="0"),
        sa.Column("attempted_at", sa.TIMESTAMP(timezone=True), nullable=False, server_default=NOW),
        sa.CheckConstraint("hints_used >= 0", name="ck_stub_attempt_hints"),
        schema=SCHEMA,
    )
    op.create_index(
        "ix_stub_attempt_user_item",
        "stub_attempt_outcomes",
        ["user_id", "item_id", "attempted_at"],
        schema=SCHEMA,
    )

    op.create_table(
        "mastery_evidence",
        sa.Column("evidence_id", sa.BigInteger(), sa.Identity(), primary_key=True),
        sa.Column("user_id", postgresql.UUID(), nullable=False),
        sa.Column("concept_id", sa.Text(), nullable=False),
        sa.Column("item_id", sa.Text(), nullable=False),
        sa.Column("source", sa.Text(), nullable=False),
        sa.Column("source_ref", sa.Text(), nullable=False),
        sa.Column("correct_raw", sa.Boolean(), nullable=False),
        sa.Column("hints_used", sa.SmallInteger(), nullable=False),
        sa.Column("correct", sa.Boolean(), nullable=False),
        sa.Column("observed_at", sa.TIMESTAMP(timezone=True), nullable=False),
        sa.Column("mastery_before", sa.Float(), nullable=False),
        sa.Column("mastery_after", sa.Float(), nullable=False),
        sa.Column("params_version", sa.Text(), nullable=False),
        sa.Column("created_at", sa.TIMESTAMP(timezone=True), nullable=False, server_default=NOW),
        sa.CheckConstraint(
            "source IN ('pretest', 'practice', 'posttest')", name="ck_mastery_evidence_source"
        ),
        sa.UniqueConstraint("source", "source_ref", name="uq_mastery_evidence_source_ref"),
        schema=SCHEMA,
    )
    op.create_index(
        "ix_mastery_evidence_user_concept",
        "mastery_evidence",
        ["user_id", "concept_id", "observed_at"],
        schema=SCHEMA,
    )

    op.create_table(
        "concept_mastery",
        sa.Column("user_id", postgresql.UUID(), primary_key=True),
        sa.Column("concept_id", sa.Text(), primary_key=True),
        sa.Column("p_mastery", sa.Float(), nullable=False),
        sa.Column("evidence_count", sa.Integer(), nullable=False),
        sa.Column("needs_reassessment", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("params_version", sa.Text(), nullable=False),
        sa.Column("updated_at", sa.TIMESTAMP(timezone=True), nullable=False, server_default=NOW),
        sa.CheckConstraint("p_mastery >= 0 AND p_mastery <= 1", name="ck_concept_mastery_range"),
        schema=SCHEMA,
    )

    op.create_table(
        "recommendation",
        sa.Column("user_id", postgresql.UUID(), primary_key=True),
        sa.Column("module_id", sa.Text(), primary_key=True),
        sa.Column("next_concept_id", sa.Text(), nullable=False),
        sa.Column("next_topic_id", sa.Text(), nullable=False),
        sa.Column("target_concept_id", sa.Text(), nullable=True),
        sa.Column("weak_prerequisite_id", sa.Text(), nullable=True),
        sa.Column("readiness", sa.Float(), nullable=False),
        sa.Column("explanation", sa.Text(), nullable=True),
        sa.Column("reason", sa.Text(), nullable=False),
        sa.Column("model_version", sa.Text(), nullable=False),
        sa.Column("graph_version", sa.Text(), nullable=False),
        sa.Column("updated_at", sa.TIMESTAMP(timezone=True), nullable=False, server_default=NOW),
        sa.CheckConstraint(
            "reason IN ('adaptive', 'revision_high_load', 'reassessment', 'fixed_order')",
            name="ck_recommendation_reason",
        ),
        schema=SCHEMA,
    )

    # Published views: contracts/views/curriculum.v_*.md
    op.execute(
        """
        CREATE VIEW curriculum.v_mastery AS
        SELECT user_id, concept_id,
               round(p_mastery::numeric, 4) AS mastery_score,
               p_mastery >= 0.70 AS is_mastered,
               evidence_count, needs_reassessment, updated_at
        FROM curriculum.concept_mastery
        """
    )
    op.execute(
        """
        CREATE VIEW curriculum.v_topic_mastery AS
        WITH learners AS (SELECT DISTINCT user_id FROM curriculum.concept_mastery)
        SELECT l.user_id, c.topic_id,
               round(min(coalesce(m.p_mastery, 0))::numeric, 4) AS mastery_score,
               min(coalesce(m.p_mastery, 0)) >= 0.70
                   AND NOT bool_or(coalesce(m.needs_reassessment, false)) AS is_mastered,
               count(*)::int AS concepts_total,
               (count(*) FILTER (WHERE m.p_mastery >= 0.70))::int AS concepts_mastered,
               max(m.updated_at) AS updated_at
        FROM learners AS l
        CROSS JOIN core.concepts AS c
        LEFT JOIN curriculum.concept_mastery AS m
               ON m.user_id = l.user_id AND m.concept_id = c.concept_id
        GROUP BY l.user_id, c.topic_id
        """
    )
    # One row per learner: the module they asked about most recently.
    op.execute(
        """
        CREATE VIEW curriculum.v_next_topic AS
        SELECT DISTINCT ON (user_id)
               user_id, next_topic_id, next_concept_id, target_concept_id,
               weak_prerequisite_id, round(readiness::numeric, 4) AS readiness,
               explanation, reason, model_version, updated_at
        FROM curriculum.recommendation
        ORDER BY user_id, updated_at DESC
        """
    )


def downgrade() -> None:
    for view in ("v_next_topic", "v_topic_mastery", "v_mastery"):
        op.execute(f"DROP VIEW IF EXISTS curriculum.{view}")
    op.drop_table("recommendation", schema=SCHEMA)
    op.drop_table("concept_mastery", schema=SCHEMA)
    op.drop_index("ix_mastery_evidence_user_concept", table_name="mastery_evidence", schema=SCHEMA)
    op.drop_table("mastery_evidence", schema=SCHEMA)
    op.drop_index("ix_stub_attempt_user_item", table_name="stub_attempt_outcomes", schema=SCHEMA)
    op.drop_table("stub_attempt_outcomes", schema=SCHEMA)
