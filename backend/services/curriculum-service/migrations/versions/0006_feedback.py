"""curriculum: learner ratings of recommendation explanations (helpful or not)

Revision ID: 0006_feedback
Revises: 0005_paper_versions
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0006_feedback"
down_revision: str | None = "0005_paper_versions"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

SCHEMA = "curriculum"
NOW = sa.text("now()")


def upgrade() -> None:
    # One rating per learner and explanation; the explanation and model are copied from the
    # stored recommendation on the server, never taken from the browser.
    op.create_table(
        "explanation_feedback",
        sa.Column("feedback_id", sa.BigInteger(), sa.Identity(), primary_key=True),
        sa.Column("user_id", postgresql.UUID(), nullable=False),
        sa.Column("module_id", sa.Text(), nullable=False),
        sa.Column("concept_id", sa.Text(), nullable=False),
        sa.Column("explanation", sa.Text(), nullable=False),
        sa.Column("model_version", sa.Text(), nullable=False),
        sa.Column("helpful", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.TIMESTAMP(timezone=True), nullable=False, server_default=NOW),
        sa.UniqueConstraint(
            "user_id", "module_id", "concept_id", "explanation", name="uq_explanation_feedback"
        ),
        schema=SCHEMA,
    )


def downgrade() -> None:
    op.drop_table("explanation_feedback", schema=SCHEMA)
