"""tutor: lecturer-made practicals and the history of replaced ones

assessment_items  one row per practical a lecturer drafted, approved, rejected or replaced, and a
                  snapshot of every authored practical that was replaced. The authored Markdown
                  is untouched; this table only overlays it.

Revision ID: 0009_assessment_items
Revises: 0008_practicals
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0009_assessment_items"
down_revision: str | None = "0008_practicals"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "assessment_items",
        sa.Column(
            "item_id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.func.gen_random_uuid(),
        ),
        sa.Column("question_id", sa.Text(), nullable=False, unique=True),
        sa.Column("slot_id", sa.Text(), nullable=False),
        sa.Column("concept_id", sa.Text(), nullable=False),
        sa.Column("origin", sa.Text(), nullable=False),
        sa.Column("status", sa.Text(), nullable=False),
        sa.Column("number", sa.SmallInteger(), nullable=False),
        sa.Column("level", sa.SmallInteger(), nullable=False),
        sa.Column("statement", sa.Text(), nullable=False),
        sa.Column("reference_solution", sa.Text(), nullable=False),
        sa.Column("checks", postgresql.JSONB()),
        sa.Column("generation", postgresql.JSONB()),
        sa.Column("replaces_question_id", sa.Text()),
        sa.Column("replaced_by_question_id", sa.Text()),
        sa.Column("created_by", postgresql.UUID(as_uuid=True)),
        sa.Column(
            "created_at", sa.TIMESTAMP(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column("reviewed_by", postgresql.UUID(as_uuid=True)),
        sa.Column("reviewed_at", sa.TIMESTAMP(timezone=True)),
        sa.Column("review_note", sa.Text()),
        sa.Column("retired_at", sa.TIMESTAMP(timezone=True)),
        sa.Column("retired_by", postgresql.UUID(as_uuid=True)),
        sa.CheckConstraint(
            "origin IN ('authored', 'generated', 'manual')", name="ck_assessment_items_origin"
        ),
        sa.CheckConstraint(
            "status IN ('draft', 'approved', 'rejected', 'retired')",
            name="ck_assessment_items_status",
        ),
        schema="tutor",
    )
    op.create_index("ix_assessment_items_slot", "assessment_items", ["slot_id"], schema="tutor")
    op.create_index(
        "uq_assessment_items_one_approved_per_slot",
        "assessment_items",
        ["slot_id"],
        unique=True,
        schema="tutor",
        postgresql_where=sa.text("status = 'approved'"),
    )


def downgrade() -> None:
    op.drop_table("assessment_items", schema="tutor")
