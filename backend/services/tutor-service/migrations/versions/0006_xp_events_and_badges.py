"""tutor: xp_events and user_badges, the gamification layer's records

xp_events    bonus XP (concept cleared, flawless run, concept mastered, quest complete,
             streak). (user_id, kind, ref) is unique so a bonus is never paid twice.
user_badges  which badges a student holds and when they earned them.

Revision ID: 0006_xp_events_and_badges
Revises: 0005_verified_explanations
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0006_xp_events_and_badges"
down_revision: str | None = "0005_verified_explanations"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

KINDS = ("concept_clear", "flawless", "mastery", "quest", "streak")


def upgrade() -> None:
    op.create_table(
        "xp_events",
        sa.Column(
            "event_id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.func.gen_random_uuid(),
        ),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("session_id", postgresql.UUID(as_uuid=True)),
        sa.Column("kind", sa.Text(), nullable=False),
        sa.Column("ref", sa.Text(), nullable=False),
        sa.Column("amount", sa.Integer(), nullable=False),
        sa.Column(
            "created_at", sa.TIMESTAMP(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.ForeignKeyConstraint(
            ["session_id"],
            ["tutor.sessions.session_id"],
            name="fk_xp_events_session_id_sessions",
            ondelete="SET NULL",
        ),
        sa.CheckConstraint(
            "kind IN (" + ", ".join(repr(k) for k in KINDS) + ")", name="ck_xp_events_kind"
        ),
        sa.CheckConstraint("amount > 0", name="ck_xp_events_amount"),
        sa.UniqueConstraint("user_id", "kind", "ref", name="uq_xp_events_once"),
        schema="tutor",
    )
    op.create_index("ix_xp_events_user", "xp_events", ["user_id"], schema="tutor")
    op.create_index("ix_xp_events_session", "xp_events", ["session_id"], schema="tutor")

    op.create_table(
        "user_badges",
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("badge_id", sa.Text(), nullable=False),
        sa.Column("session_id", postgresql.UUID(as_uuid=True)),
        sa.Column(
            "earned_at", sa.TIMESTAMP(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.PrimaryKeyConstraint("user_id", "badge_id"),
        sa.ForeignKeyConstraint(
            ["session_id"],
            ["tutor.sessions.session_id"],
            name="fk_user_badges_session_id_sessions",
            ondelete="SET NULL",
        ),
        schema="tutor",
    )
    op.create_index("ix_user_badges_session", "user_badges", ["session_id"], schema="tutor")


def downgrade() -> None:
    op.drop_table("user_badges", schema="tutor")
    op.drop_table("xp_events", schema="tutor")
