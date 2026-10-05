"""content: units and chunks; tutor: gate decision log

content.units    one row per authored file (a concept, or a module introduction)
content.chunks   the retrievable pieces of a unit, tagged with their section type
tutor.gate_events  every faithfulness-gate decision, logged from the first day

Sessions, checkpoints and attempts arrive in P2 with the code that writes them.

Revision ID: 0001_tutor
Revises:
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0001_tutor"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

CONTENT = "content"
TUTOR = "tutor"

SECTION_TYPES = (
    "overview",
    "objectives",
    "prerequisites",
    "theory",
    "example",
    "misconception",
    "facts",
    "exercise",
    "solution",
    "rubric",
)


def _in(column: str, values: tuple[str, ...]) -> str:
    return f"{column} IN ({', '.join(repr(v) for v in values)})"


def upgrade() -> None:
    op.execute(f"CREATE SCHEMA IF NOT EXISTS {CONTENT}")
    op.execute(f"CREATE SCHEMA IF NOT EXISTS {TUTOR}")
    op.execute("CREATE EXTENSION IF NOT EXISTS pgcrypto")

    # ------------------------------------------------------------------ units
    op.create_table(
        "units",
        sa.Column("unit_id", sa.Text(), primary_key=True),
        sa.Column("module_id", sa.Text(), nullable=False),
        sa.Column("concept_id", sa.Text()),
        sa.Column("kind", sa.Text(), nullable=False),
        sa.Column("sequence", sa.Integer(), nullable=False),
        sa.Column("topic", sa.Text()),
        sa.Column("title", sa.Text(), nullable=False),
        sa.Column("difficulty", sa.SmallInteger()),
        sa.Column(
            "prerequisites", postgresql.ARRAY(sa.Text()), nullable=False, server_default="{}"
        ),
        sa.Column(
            "cross_module_prerequisites",
            postgresql.ARRAY(sa.Text()),
            nullable=False,
            server_default="{}",
        ),
        sa.Column("java_version", sa.SmallInteger()),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("status", sa.Text(), nullable=False),
        sa.Column("source_path", sa.Text(), nullable=False),
        sa.Column("content_hash", sa.Text(), nullable=False),
        sa.Column(
            "synced_at", sa.TIMESTAMP(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.CheckConstraint(_in("kind", ("concept", "module_introduction")), name="ck_units_kind"),
        sa.CheckConstraint(_in("status", ("draft", "reviewed")), name="ck_units_status"),
        schema=CONTENT,
    )
    op.create_index("ix_units_module_sequence", "units", ["module_id", "sequence"], schema=CONTENT)
    op.create_index(
        "uq_units_concept",
        "units",
        ["concept_id"],
        unique=True,
        schema=CONTENT,
        postgresql_where=sa.text("concept_id IS NOT NULL"),
    )

    # ----------------------------------------------------------------- chunks
    op.create_table(
        "chunks",
        sa.Column("chunk_id", sa.Text(), primary_key=True),
        sa.Column("unit_id", sa.Text(), nullable=False),
        sa.Column("module_id", sa.Text(), nullable=False),
        sa.Column("concept_id", sa.Text()),
        sa.Column("section_type", sa.Text(), nullable=False),
        sa.Column("ordinal", sa.Integer(), nullable=False),
        sa.Column("heading_path", sa.Text(), nullable=False),
        sa.Column("headings", postgresql.ARRAY(sa.Text()), nullable=False, server_default="{}"),
        sa.Column("question_nos", postgresql.ARRAY(sa.Integer())),
        sa.Column("level", sa.SmallInteger()),
        sa.Column("text", sa.Text(), nullable=False),
        sa.Column("word_count", sa.Integer(), nullable=False),
        sa.Column("text_hash", sa.Text(), nullable=False),
        sa.Column(
            "synced_at", sa.TIMESTAMP(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.ForeignKeyConstraint(
            ["unit_id"], [f"{CONTENT}.units.unit_id"], name="fk_chunks_unit", ondelete="CASCADE"
        ),
        sa.CheckConstraint(_in("section_type", SECTION_TYPES), name="ck_chunks_section_type"),
        schema=CONTENT,
    )
    op.create_index(
        "uq_chunks_unit_ordinal", "chunks", ["unit_id", "ordinal"], unique=True, schema=CONTENT
    )
    op.create_index(
        "ix_chunks_module_section", "chunks", ["module_id", "section_type"], schema=CONTENT
    )
    op.create_index("ix_chunks_concept", "chunks", ["concept_id"], schema=CONTENT)

    # ------------------------------------------------------------ gate_events
    op.create_table(
        "gate_events",
        sa.Column(
            "event_id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.func.gen_random_uuid(),
        ),
        sa.Column("output_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("attempt", sa.SmallInteger(), nullable=False, server_default="1"),
        sa.Column("generation_mode", sa.Text(), nullable=False),
        sa.Column("granularity", sa.Text(), nullable=False),
        sa.Column("retrieval_condition", sa.Text(), nullable=False, server_default="normal"),
        sa.Column("claim_text", sa.Text(), nullable=False),
        sa.Column("passage_ids", postgresql.ARRAY(sa.Text()), nullable=False, server_default="{}"),
        sa.Column("nli_model", sa.Text(), nullable=False),
        sa.Column("nli_label", sa.Text()),
        sa.Column("nli_score", sa.Float()),
        sa.Column("decision", sa.Text(), nullable=False),
        sa.Column("latency_ms", sa.Integer(), nullable=False),
        sa.Column(
            "created_at", sa.TIMESTAMP(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.CheckConstraint(
            _in("generation_mode", ("tutoring", "practical", "grading")),
            name="ck_gate_events_mode",
        ),
        sa.CheckConstraint(
            _in("granularity", ("claim", "whole_response")), name="ck_gate_events_granularity"
        ),
        sa.CheckConstraint(
            _in("retrieval_condition", ("normal", "degraded")),
            name="ck_gate_events_retrieval_condition",
        ),
        sa.CheckConstraint(_in("decision", ("pass", "block")), name="ck_gate_events_decision"),
        schema=TUTOR,
    )
    op.create_index("ix_gate_events_output", "gate_events", ["output_id"], schema=TUTOR)
    op.create_index("ix_gate_events_created", "gate_events", ["created_at"], schema=TUTOR)


def downgrade() -> None:
    op.drop_table("gate_events", schema=TUTOR)
    op.drop_table("chunks", schema=CONTENT)
    op.drop_table("units", schema=CONTENT)
