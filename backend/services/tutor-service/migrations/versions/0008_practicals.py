"""tutor: practicals, their tests and the attempts made at them

practical_tests     the tests a practical is marked with. Visible ones are shown to the student;
                    hidden ones are not. Expected output comes from the course's own reference
                    solution, never from a model.
practical_attempts  every submission: the code, whether it passed, and how many tests it passed.

Also lets xp_events record the new "practical" bonus.

Revision ID: 0008_practicals
Revises: 0007_text_sources
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0008_practicals"
down_revision: str | None = "0007_text_sources"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

OLD_KINDS = ("concept_clear", "flawless", "mastery", "quest", "streak")
NEW_KINDS = (*OLD_KINDS, "practical")


def _in(kinds: tuple[str, ...]) -> str:
    return "kind IN (" + ", ".join(repr(k) for k in kinds) + ")"


def upgrade() -> None:
    op.create_table(
        "practical_tests",
        sa.Column("question_id", sa.Text(), nullable=False),
        sa.Column("test_no", sa.SmallInteger(), nullable=False),
        sa.Column("stdin", sa.Text(), nullable=False),
        sa.Column("expected", sa.Text(), nullable=False),
        sa.Column("visible", sa.Boolean(), nullable=False),
        sa.Column("source", sa.Text(), nullable=False),
        sa.Column(
            "created_at", sa.TIMESTAMP(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.PrimaryKeyConstraint("question_id", "test_no"),
        sa.CheckConstraint("source IN ('sample', 'generated')", name="ck_practical_tests_source"),
        schema="tutor",
    )

    op.create_table(
        "practical_attempts",
        sa.Column(
            "attempt_id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.func.gen_random_uuid(),
        ),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("question_id", sa.Text(), nullable=False),
        sa.Column("source", sa.Text(), nullable=False),
        sa.Column("compiled", sa.Boolean(), nullable=False),
        sa.Column("passed", sa.Boolean(), nullable=False),
        sa.Column("tests_passed", sa.SmallInteger(), nullable=False),
        sa.Column("tests_total", sa.SmallInteger(), nullable=False),
        sa.Column(
            "created_at", sa.TIMESTAMP(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        schema="tutor",
    )
    op.create_index(
        "ix_practical_attempts_user",
        "practical_attempts",
        ["user_id", "question_id"],
        schema="tutor",
    )

    op.drop_constraint("ck_xp_events_kind", "xp_events", schema="tutor", type_="check")
    op.create_check_constraint("ck_xp_events_kind", "xp_events", _in(NEW_KINDS), schema="tutor")


def downgrade() -> None:
    op.execute("DELETE FROM tutor.xp_events WHERE kind = 'practical'")
    op.drop_constraint("ck_xp_events_kind", "xp_events", schema="tutor", type_="check")
    op.create_check_constraint("ck_xp_events_kind", "xp_events", _in(OLD_KINDS), schema="tutor")
    op.drop_table("practical_attempts", schema="tutor")
    op.drop_table("practical_tests", schema="tutor")
