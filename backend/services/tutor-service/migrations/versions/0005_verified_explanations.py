"""tutor: verified_explanations, gate-checked explanations shared across sessions

An explanation depends only on the course passage it explains, so once the faithfulness
gate has passed one it can be shown to every student without another model call. The key
holds everything that could change the answer (the passage text, the prompt, the model, the
gate settings), so changing any of them starts a fresh cache instead of serving stale text.
Only texts the gate PASSED are ever stored here.

Revision ID: 0005_verified_explanations
Revises: 0004_text_verification
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0005_verified_explanations"
down_revision: str | None = "0004_text_verification"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "verified_explanations",
        sa.Column("passage_id", sa.Text(), nullable=False),
        sa.Column("passage_hash", sa.Text(), nullable=False),
        sa.Column("fingerprint", sa.Text(), nullable=False),
        sa.Column("text", sa.Text(), nullable=False),
        sa.Column("provider", sa.Text(), nullable=False),
        sa.Column("model", sa.Text(), nullable=False),
        sa.Column("output_id", postgresql.UUID(as_uuid=True)),
        sa.Column(
            "created_at", sa.TIMESTAMP(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.PrimaryKeyConstraint("passage_id", "passage_hash", "fingerprint"),
        schema="tutor",
    )


def downgrade() -> None:
    op.drop_table("verified_explanations", schema="tutor")
