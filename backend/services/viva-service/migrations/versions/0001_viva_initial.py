"""viva schema: question bank, sessions, turns, results, ratings, budgets, local login.

Revision ID: 0001
Revises:
Create Date: 2026-10-07
"""

import sqlalchemy as sa
from alembic import op

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None

SCHEMA = "viva"


def upgrade() -> None:
    op.create_table(
        "generated_question_bank",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("topic_id", sa.String(), nullable=False, index=True),
        sa.Column("status", sa.String(), nullable=False, index=True),
        sa.Column("data", sa.JSON(), nullable=False),
        schema=SCHEMA,
    )
    op.create_table(
        "usage_counters",
        sa.Column("key", sa.String(250), primary_key=True),
        sa.Column("used", sa.Integer(), nullable=False),
        sa.Column("expires", sa.Integer(), nullable=False, index=True),
        schema=SCHEMA,
    )
    op.create_table(
        "users",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("participant_code", sa.String(64), nullable=False),
        sa.Column("role", sa.String(20), nullable=False),
        sa.Column("staff_identity", sa.String(), nullable=True, unique=True),
        schema=SCHEMA,
    )
    op.create_table(
        "auth_tokens",
        sa.Column("digest", sa.String(), primary_key=True),
        sa.Column("user_id", sa.String(), sa.ForeignKey(f"{SCHEMA}.users.id"), nullable=False),
        sa.Column("expires_at", sa.String(), nullable=False),
        schema=SCHEMA,
    )
    op.create_table(
        "courses",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("name", sa.String(150), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("created_by", sa.String(), sa.ForeignKey(f"{SCHEMA}.users.id"), nullable=False),
        sa.Column("created_at", sa.String(), nullable=False),
        schema=SCHEMA,
    )
    op.create_table(
        "human_ratings",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("rater_id", sa.String(), sa.ForeignKey(f"{SCHEMA}.users.id"), nullable=False),
        sa.Column("case_id", sa.String(), nullable=False),
        sa.Column("condition", sa.String(1), nullable=False),
        sa.Column("data", sa.JSON(), nullable=False),
        sa.UniqueConstraint("rater_id", "case_id", "condition"),
        schema=SCHEMA,
    )
    op.create_table(
        "viva_sessions",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column(
            "user_id", sa.String(), sa.ForeignKey(f"{SCHEMA}.users.id"), nullable=False, index=True
        ),
        sa.Column("status", sa.String(), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("data", sa.JSON(), nullable=False),
        schema=SCHEMA,
    )
    op.create_table(
        "course_materials",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column(
            "course_id",
            sa.String(),
            sa.ForeignKey(f"{SCHEMA}.courses.id"),
            nullable=False,
            index=True,
        ),
        sa.Column("digest", sa.String(), nullable=False),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("chunks", sa.JSON(), nullable=False),
        sa.UniqueConstraint("course_id", "digest"),
        schema=SCHEMA,
    )
    op.create_table(
        "integration_events",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column(
            "session_id",
            sa.String(),
            sa.ForeignKey(f"{SCHEMA}.viva_sessions.id"),
            nullable=False,
            index=True,
        ),
        sa.Column("data", sa.JSON(), nullable=False),
        schema=SCHEMA,
    )
    op.create_table(
        "viva_results",
        sa.Column(
            "session_id", sa.String(), sa.ForeignKey(f"{SCHEMA}.viva_sessions.id"), primary_key=True
        ),
        sa.Column("data", sa.JSON(), nullable=False),
        schema=SCHEMA,
    )
    op.create_table(
        "viva_turns",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column(
            "session_id",
            sa.String(),
            sa.ForeignKey(f"{SCHEMA}.viva_sessions.id"),
            nullable=False,
            index=True,
        ),
        sa.Column("question_id", sa.String(), nullable=False),
        sa.Column("request_id", sa.String(128), nullable=False),
        sa.Column("request_digest", sa.String(), nullable=False),
        sa.Column("data", sa.JSON(), nullable=False),
        sa.Column("response", sa.JSON(), nullable=False),
        sa.UniqueConstraint("session_id", "request_id"),
        sa.UniqueConstraint("session_id", "question_id"),
        schema=SCHEMA,
    )


def downgrade() -> None:
    op.drop_table("viva_turns", schema=SCHEMA)
    op.drop_table("viva_results", schema=SCHEMA)
    op.drop_table("integration_events", schema=SCHEMA)
    op.drop_table("course_materials", schema=SCHEMA)
    op.drop_table("viva_sessions", schema=SCHEMA)
    op.drop_table("human_ratings", schema=SCHEMA)
    op.drop_table("courses", schema=SCHEMA)
    op.drop_table("auth_tokens", schema=SCHEMA)
    op.drop_table("users", schema=SCHEMA)
    op.drop_table("usage_counters", schema=SCHEMA)
    op.drop_table("generated_question_bank", schema=SCHEMA)
