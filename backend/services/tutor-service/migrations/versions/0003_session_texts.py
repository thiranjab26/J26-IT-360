"""tutor: session_texts, the words the tutor showed at each point of a session

Revision ID: 0003_session_texts
Revises: 0002_sessions
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0003_session_texts"
down_revision: str | None = "0002_sessions"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "session_texts",
        sa.Column("session_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("key", sa.Text(), nullable=False),
        sa.Column("text", sa.Text(), nullable=False),
        sa.Column("source", sa.Text(), nullable=False),
        sa.Column("provider", sa.Text()),
        sa.Column("model", sa.Text()),
        sa.Column(
            "created_at", sa.TIMESTAMP(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.PrimaryKeyConstraint("session_id", "key"),
        sa.ForeignKeyConstraint(
            ["session_id"],
            ["tutor.sessions.session_id"],
            name="fk_session_texts_session",
            ondelete="CASCADE",
        ),
        sa.CheckConstraint("source IN ('generated', 'authored')", name="ck_session_texts_source"),
        schema="tutor",
    )


def downgrade() -> None:
    op.drop_table("session_texts", schema="tutor")
