"""curriculum: C3 stand-in practice items and hint log

Revision ID: 0004_practice
Revises: 0003_assessment
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0004_practice"
down_revision: str | None = "0003_assessment"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

SCHEMA = "curriculum"
NOW = sa.text("now()")


def upgrade() -> None:
    # Practice questions for the C3 stand-in. Answers are checked on the server; the
    # outcome goes to stub_attempt_outcomes with C3's contract columns.
    op.create_table(
        "practice_item",
        sa.Column("item_id", sa.Text(), primary_key=True),
        sa.Column("concept_id", sa.Text(), nullable=False),
        sa.Column("stem", sa.Text(), nullable=False),
        sa.Column("options", postgresql.JSONB(), nullable=False),
        sa.Column("answer_index", sa.SmallInteger(), nullable=False),
        sa.Column("hint", sa.Text(), nullable=True),
        sa.Column("retired", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("bank_version", sa.Text(), nullable=False),
        sa.Column("updated_at", sa.TIMESTAMP(timezone=True), nullable=False, server_default=NOW),
        sa.CheckConstraint("answer_index >= 0", name="ck_practice_item_answer"),
        schema=SCHEMA,
    )
    op.create_index("ix_practice_item_concept", "practice_item", ["concept_id"], schema=SCHEMA)

    # One row per hint shown; hints before the first answer make that answer count as wrong.
    op.create_table(
        "practice_hint",
        sa.Column("hint_id", sa.BigInteger(), sa.Identity(), primary_key=True),
        sa.Column("user_id", postgresql.UUID(), nullable=False),
        sa.Column("item_id", sa.Text(), nullable=False),
        sa.Column("shown_at", sa.TIMESTAMP(timezone=True), nullable=False, server_default=NOW),
        schema=SCHEMA,
    )
    op.create_index(
        "ix_practice_hint_user_item", "practice_hint", ["user_id", "item_id"], schema=SCHEMA
    )


def downgrade() -> None:
    op.drop_index("ix_practice_hint_user_item", table_name="practice_hint", schema=SCHEMA)
    op.drop_table("practice_hint", schema=SCHEMA)
    op.drop_index("ix_practice_item_concept", table_name="practice_item", schema=SCHEMA)
    op.drop_table("practice_item", schema=SCHEMA)
