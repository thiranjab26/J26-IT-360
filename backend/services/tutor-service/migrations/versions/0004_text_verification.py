"""tutor: record whether the gate verified a stored text, and which generated output it was

verified   true if the faithfulness gate passed it, false if the gate blocked the model's
           wording and the authored passage was shown instead, null if no gate ran
output_id  the generated output (tutor.gate_events.output_id) this text came from

Revision ID: 0004_text_verification
Revises: 0003_session_texts
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0004_text_verification"
down_revision: str | None = "0003_session_texts"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("session_texts", sa.Column("verified", sa.Boolean()), schema="tutor")
    op.add_column(
        "session_texts", sa.Column("output_id", postgresql.UUID(as_uuid=True)), schema="tutor"
    )


def downgrade() -> None:
    op.drop_column("session_texts", "output_id", schema="tutor")
    op.drop_column("session_texts", "verified", schema="tutor")
