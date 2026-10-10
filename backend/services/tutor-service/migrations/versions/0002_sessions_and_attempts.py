"""tutor: guided sessions, checkpoint attempts, and the v_attempt_outcomes view

tutor.sessions             one row per guided session; the state machine's fields
tutor.checkpoint_attempts  every answer a student gave, marked
tutor.v_attempt_outcomes   the published view C1 reads as mastery evidence

The view is the contract in contracts/views/tutor.v_attempt_outcomes.md. It carries
gating checkpoints only: a multiple-choice pulse check is a recall check that, by
design, is not evidence of mastery.

Revision ID: 0002_sessions
Revises: 0001_tutor
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0002_sessions"
down_revision: str | None = "0001_tutor"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

TUTOR = "tutor"

PHASES = ("hook", "teach", "checkpoint", "feedback", "reteach", "ended")
EXITS = (
    "completed",
    "mastery_satisfied",
    "struggling",
    "load_exit",
    "student_ended",
    "timeout",
)


def _in(column: str, values: tuple[str, ...]) -> str:
    return f"{column} IN ({', '.join(repr(v) for v in values)})"


def upgrade() -> None:
    op.create_table(
        "sessions",
        sa.Column(
            "session_id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.func.gen_random_uuid(),
        ),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("module_id", sa.Text(), nullable=False),
        sa.Column("concept_id", sa.Text(), nullable=False),
        sa.Column("policy", sa.Text(), nullable=False),
        sa.Column("steps", postgresql.JSONB(), nullable=False),
        sa.Column("step_index", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("phase", sa.Text(), nullable=False),
        sa.Column("attempts", sa.SmallInteger(), nullable=False, server_default="0"),
        sa.Column("last_outcome", sa.Text()),
        sa.Column("passed", postgresql.ARRAY(sa.Text()), nullable=False, server_default="{}"),
        sa.Column(
            "passed_gating", postgresql.ARRAY(sa.Text()), nullable=False, server_default="{}"
        ),
        sa.Column("exit_reason", sa.Text()),
        sa.Column(
            "started_at", sa.TIMESTAMP(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column(
            "last_activity_at",
            sa.TIMESTAMP(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column("ended_at", sa.TIMESTAMP(timezone=True)),
        sa.CheckConstraint(_in("phase", PHASES), name="ck_sessions_phase"),
        sa.CheckConstraint(
            "exit_reason IS NULL OR " + _in("exit_reason", EXITS), name="ck_sessions_exit"
        ),
        sa.CheckConstraint(
            _in("policy", ("mastery_gated", "points_only")), name="ck_sessions_policy"
        ),
        sa.CheckConstraint(
            "(phase = 'ended') = (ended_at IS NOT NULL)", name="ck_sessions_ended_consistent"
        ),
        schema=TUTOR,
    )
    # At most one active session per student, enforced here rather than only in code.
    op.create_index(
        "uq_sessions_one_active_per_user",
        "sessions",
        ["user_id"],
        unique=True,
        schema=TUTOR,
        postgresql_where=sa.text("ended_at IS NULL"),
    )
    op.create_index("ix_sessions_user_started", "sessions", ["user_id", "started_at"], schema=TUTOR)

    op.create_table(
        "checkpoint_attempts",
        sa.Column(
            "attempt_id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.func.gen_random_uuid(),
        ),
        sa.Column("session_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("question_id", sa.Text(), nullable=False),
        sa.Column("concept_id", sa.Text(), nullable=False),
        sa.Column("kind", sa.Text(), nullable=False),
        sa.Column("gating", sa.Boolean(), nullable=False),
        sa.Column("attempt_no", sa.SmallInteger(), nullable=False),
        sa.Column("answer", sa.Text(), nullable=False),
        sa.Column("outcome", sa.Text(), nullable=False),
        sa.Column("reason", sa.Text(), nullable=False, server_default=""),
        sa.Column("xp", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("hints_used", sa.SmallInteger(), nullable=False, server_default="0"),
        sa.Column(
            "created_at", sa.TIMESTAMP(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.ForeignKeyConstraint(
            ["session_id"],
            [f"{TUTOR}.sessions.session_id"],
            name="fk_checkpoint_attempts_session",
            ondelete="CASCADE",
        ),
        sa.CheckConstraint(
            _in("outcome", ("correct", "wrong", "unreadable")), name="ck_attempts_outcome"
        ),
        sa.CheckConstraint("xp >= 0", name="ck_attempts_xp"),
        schema=TUTOR,
    )
    op.create_index(
        "ix_attempts_session", "checkpoint_attempts", ["session_id", "created_at"], schema=TUTOR
    )
    op.create_index("ix_attempts_concept", "checkpoint_attempts", ["concept_id"], schema=TUTOR)

    op.execute(
        """
        CREATE VIEW tutor.v_attempt_outcomes AS
        SELECT s.user_id,
               a.concept_id,
               a.question_id AS item_id,
               (a.outcome = 'correct') AS correct,
               a.hints_used,
               a.created_at AS attempted_at
          FROM tutor.checkpoint_attempts a
          JOIN tutor.sessions s USING (session_id)
         WHERE a.gating
           AND a.outcome IN ('correct', 'wrong')
        """
    )


def downgrade() -> None:
    op.execute("DROP VIEW IF EXISTS tutor.v_attempt_outcomes")
    op.drop_table("checkpoint_attempts", schema=TUTOR)
    op.drop_table("sessions", schema=TUTOR)
