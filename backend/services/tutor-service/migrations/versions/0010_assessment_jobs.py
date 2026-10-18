"""tutor: batches of generated draft practicals

assessment_jobs  one row per lecturer request to generate drafts: how many were asked for, how
                 many are done or failed, and which drafts came out. The drafts themselves are
                 ordinary assessment_items.

Revision ID: 0010_assessment_jobs
Revises: 0009_assessment_items
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0010_assessment_jobs"
down_revision: str | None = "0009_assessment_items"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "assessment_jobs",
        sa.Column(
            "job_id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.func.gen_random_uuid(),
        ),
        sa.Column("concept_id", sa.Text(), nullable=False),
        sa.Column("requested", sa.SmallInteger(), nullable=False),
        sa.Column("done", sa.SmallInteger(), nullable=False, server_default="0"),
        sa.Column("failed", sa.SmallInteger(), nullable=False, server_default="0"),
        sa.Column("status", sa.Text(), nullable=False),
        sa.Column("hint", sa.Text()),
        sa.Column("targets", postgresql.JSONB(), nullable=False),
        sa.Column("item_ids", postgresql.JSONB(), nullable=False),
        sa.Column("message", sa.Text()),
        sa.Column("created_by", postgresql.UUID(as_uuid=True)),
        sa.Column(
            "created_at", sa.TIMESTAMP(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column("finished_at", sa.TIMESTAMP(timezone=True)),
        sa.CheckConstraint(
            "status IN ('queued', 'running', 'finished', 'failed')",
            name="ck_assessment_jobs_status",
        ),
        schema="tutor",
    )
    op.create_index("ix_assessment_jobs_created", "assessment_jobs", ["created_at"], schema="tutor")


def downgrade() -> None:
    op.drop_table("assessment_jobs", schema="tutor")
