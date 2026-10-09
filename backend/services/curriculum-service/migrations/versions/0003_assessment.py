"""curriculum: study window, groups, pre/post test papers, attempts, mastery snapshot

Revision ID: 0003_assessment
Revises: 0002_mastery
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0003_assessment"
down_revision: str | None = "0002_mastery"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

SCHEMA = "curriculum"
NOW = sa.text("now()")


def upgrade() -> None:
    # The lecturer moves each module through these phases by hand.
    op.create_table(
        "study_window",
        sa.Column("module_id", sa.Text(), primary_key=True),
        sa.Column("phase", sa.Text(), nullable=False),
        sa.Column("updated_by", postgresql.UUID(), nullable=True),
        sa.Column("updated_at", sa.TIMESTAMP(timezone=True), nullable=False, server_default=NOW),
        sa.CheckConstraint(
            "phase IN ('closed', 'pretest', 'learning', 'posttest', 'finished')",
            name="ck_study_window_phase",
        ),
        schema=SCHEMA,
    )

    op.create_table(
        "enrolment",
        sa.Column("user_id", postgresql.UUID(), primary_key=True),
        sa.Column("module_id", sa.Text(), primary_key=True),
        sa.Column("study_group", sa.Text(), nullable=False),
        sa.Column("form_order", sa.Text(), nullable=False),
        sa.Column("enrolled_at", sa.TIMESTAMP(timezone=True), nullable=False, server_default=NOW),
        sa.CheckConstraint("study_group IN ('adaptive', 'comparison')", name="ck_enrolment_group"),
        sa.CheckConstraint("form_order IN ('AB', 'BA')", name="ck_enrolment_form_order"),
        schema=SCHEMA,
    )

    op.create_table(
        "test_paper",
        sa.Column("paper_id", sa.Text(), primary_key=True),
        sa.Column("module_id", sa.Text(), nullable=False),
        sa.Column("form", sa.Text(), nullable=False),
        sa.Column("title", sa.Text(), nullable=False),
        sa.Column("bank_version", sa.Text(), nullable=False),
        sa.Column("imported_at", sa.TIMESTAMP(timezone=True), nullable=False, server_default=NOW),
        sa.CheckConstraint("form IN ('A', 'B')", name="ck_test_paper_form"),
        sa.UniqueConstraint("module_id", "form", name="uq_test_paper_module_form"),
        schema=SCHEMA,
    )

    # answer_index never leaves the service.
    op.create_table(
        "test_item",
        sa.Column("item_id", sa.Text(), primary_key=True),
        sa.Column(
            "paper_id",
            sa.Text(),
            sa.ForeignKey(f"{SCHEMA}.test_paper.paper_id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("position", sa.SmallInteger(), nullable=False),
        sa.Column("concept_id", sa.Text(), nullable=False),
        sa.Column("section", sa.Text(), nullable=False),
        sa.Column("stem", sa.Text(), nullable=False),
        sa.Column("options", postgresql.JSONB(), nullable=False),
        sa.Column("answer_index", sa.SmallInteger(), nullable=False),
        sa.Column("twin_item_id", sa.Text(), nullable=True),
        sa.CheckConstraint("section IN ('main', 'prereq')", name="ck_test_item_section"),
        sa.CheckConstraint("answer_index >= 0", name="ck_test_item_answer"),
        sa.UniqueConstraint("paper_id", "position", name="uq_test_item_paper_position"),
        schema=SCHEMA,
    )

    # One attempt per learner, module and kind: the unique key enforces it.
    op.create_table(
        "test_attempt",
        sa.Column("attempt_id", sa.BigInteger(), sa.Identity(), primary_key=True),
        sa.Column("user_id", postgresql.UUID(), nullable=False),
        sa.Column("module_id", sa.Text(), nullable=False),
        sa.Column("kind", sa.Text(), nullable=False),
        sa.Column(
            "paper_id",
            sa.Text(),
            sa.ForeignKey(f"{SCHEMA}.test_paper.paper_id"),
            nullable=False,
        ),
        sa.Column("started_at", sa.TIMESTAMP(timezone=True), nullable=False, server_default=NOW),
        sa.Column("submitted_at", sa.TIMESTAMP(timezone=True), nullable=True),
        sa.Column("main_correct", sa.SmallInteger(), nullable=True),
        sa.Column("main_total", sa.SmallInteger(), nullable=True),
        sa.Column("score_pct", sa.Float(), nullable=True),
        sa.CheckConstraint("kind IN ('pretest', 'posttest')", name="ck_test_attempt_kind"),
        sa.UniqueConstraint("user_id", "module_id", "kind", name="uq_test_attempt_once"),
        schema=SCHEMA,
    )

    op.create_table(
        "test_response",
        sa.Column(
            "attempt_id",
            sa.BigInteger(),
            sa.ForeignKey(f"{SCHEMA}.test_attempt.attempt_id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column(
            "item_id",
            sa.Text(),
            sa.ForeignKey(f"{SCHEMA}.test_item.item_id"),
            primary_key=True,
        ),
        sa.Column("chosen_index", sa.SmallInteger(), nullable=True),  # NULL = left blank
        sa.Column("correct", sa.Boolean(), nullable=False),
        schema=SCHEMA,
    )

    # Mastery as the model saw it when the post-test started (BKT validity check).
    op.create_table(
        "mastery_snapshot",
        sa.Column(
            "attempt_id",
            sa.BigInteger(),
            sa.ForeignKey(f"{SCHEMA}.test_attempt.attempt_id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("concept_id", sa.Text(), primary_key=True),
        sa.Column("p_mastery", sa.Float(), nullable=False),
        sa.Column("evidence_count", sa.Integer(), nullable=False),
        sa.Column("params_version", sa.Text(), nullable=False),
        sa.Column("taken_at", sa.TIMESTAMP(timezone=True), nullable=False, server_default=NOW),
        schema=SCHEMA,
    )


def downgrade() -> None:
    for table in (
        "mastery_snapshot",
        "test_response",
        "test_attempt",
        "test_item",
        "test_paper",
        "enrolment",
        "study_window",
    ):
        op.drop_table(table, schema=SCHEMA)
