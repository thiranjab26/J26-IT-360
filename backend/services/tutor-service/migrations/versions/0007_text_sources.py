"""tutor: record the passages a generated text was built from

sources  JSON list of {chunk_id, label, kind} for the main passage and each passage the
         retriever supplied. On session_texts (what a student saw) and on
         verified_explanations (the shared copy).

Revision ID: 0007_text_sources
Revises: 0006_xp_events_and_badges
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0007_text_sources"
down_revision: str | None = "0006_xp_events_and_badges"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    for table in ("session_texts", "verified_explanations"):
        op.add_column(table, sa.Column("sources", postgresql.JSONB()), schema="tutor")


def downgrade() -> None:
    for table in ("verified_explanations", "session_texts"):
        op.drop_column(table, "sources", schema="tutor")
