"""Tables in this service's own schemas: `content` and `tutor`.

`content` holds the indexed course material and is read by C1 and C4 through
published views (`v_unit_manifest`, `v_verified_passages`), never directly.
`tutor` holds runtime data: gate decisions now, sessions and attempts from P2.

The schema names are fixed by the architecture (one schema per owner on the shared
database), so they are constants rather than settings. Migrations are written by
hand in migrations/versions and checked against this metadata with `alembic check`.

Concept IDs here are plain text, not foreign keys into `core.concepts`. The indexer
rejects unknown IDs, and a foreign key would also block the seed script from pruning
a concept that was renamed, which is exactly when you want to be told, not blocked.
"""

from __future__ import annotations

from sqlalchemy import (
    ARRAY,
    TIMESTAMP,
    CheckConstraint,
    Column,
    Float,
    ForeignKey,
    Index,
    Integer,
    MetaData,
    SmallInteger,
    Table,
    Text,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import UUID

from app.content.models import INDEXED_SECTION_TYPES

CONTENT_SCHEMA = "content"
TUTOR_SCHEMA = "tutor"

metadata = MetaData()


def _in(column: str, values: tuple[str, ...]) -> str:
    return f"{column} IN ({', '.join(repr(v) for v in values)})"


# ---------------------------------------------------------------------------
# content.units: one row per authored file
# ---------------------------------------------------------------------------
units = Table(
    "units",
    metadata,
    Column("unit_id", Text, primary_key=True),
    Column("module_id", Text, nullable=False),
    Column("concept_id", Text),
    Column("kind", Text, nullable=False),
    Column("sequence", Integer, nullable=False),
    Column("topic", Text),
    Column("title", Text, nullable=False),
    Column("difficulty", SmallInteger),
    Column("prerequisites", ARRAY(Text), nullable=False, server_default=text("'{}'")),
    Column("cross_module_prerequisites", ARRAY(Text), nullable=False, server_default=text("'{}'")),
    Column("java_version", SmallInteger),
    Column("version", Integer, nullable=False),
    Column("status", Text, nullable=False),
    Column("source_path", Text, nullable=False),
    Column("content_hash", Text, nullable=False),
    Column("synced_at", TIMESTAMP(timezone=True), nullable=False, server_default=func.now()),
    CheckConstraint(_in("kind", ("concept", "module_introduction")), name="ck_units_kind"),
    CheckConstraint(_in("status", ("draft", "reviewed")), name="ck_units_status"),
    schema=CONTENT_SCHEMA,
)
Index("ix_units_module_sequence", units.c.module_id, units.c.sequence)
Index(
    "uq_units_concept",
    units.c.concept_id,
    unique=True,
    postgresql_where=units.c.concept_id.is_not(None),
)

# ---------------------------------------------------------------------------
# content.chunks: the retrievable pieces of a unit
# ---------------------------------------------------------------------------
chunks = Table(
    "chunks",
    metadata,
    Column("chunk_id", Text, primary_key=True),
    Column(
        "unit_id",
        Text,
        ForeignKey(f"{CONTENT_SCHEMA}.units.unit_id", ondelete="CASCADE"),
        nullable=False,
    ),
    # Denormalised from the unit so retrieval can filter without a join. Retrieval
    # is namespaced by module, so module_id is on every query.
    Column("module_id", Text, nullable=False),
    Column("concept_id", Text),
    Column("section_type", Text, nullable=False),
    # Reading order within the unit.
    Column("ordinal", Integer, nullable=False),
    Column("heading_path", Text, nullable=False),
    Column("headings", ARRAY(Text), nullable=False, server_default=text("'{}'")),
    # Exercise, solution and rubric chunks only. A rubric can cover several
    # questions, so this is a list. The grader looks up by question number.
    Column("question_nos", ARRAY(Integer)),
    Column("level", SmallInteger),
    Column("text", Text, nullable=False),
    Column("word_count", Integer, nullable=False),
    # Lets the embedder skip chunks whose text has not changed.
    Column("text_hash", Text, nullable=False),
    Column("synced_at", TIMESTAMP(timezone=True), nullable=False, server_default=func.now()),
    CheckConstraint(_in("section_type", INDEXED_SECTION_TYPES), name="ck_chunks_section_type"),
    schema=CONTENT_SCHEMA,
)
Index("uq_chunks_unit_ordinal", chunks.c.unit_id, chunks.c.ordinal, unique=True)
Index("ix_chunks_module_section", chunks.c.module_id, chunks.c.section_type)
Index("ix_chunks_concept", chunks.c.concept_id)

# ---------------------------------------------------------------------------
# tutor.gate_events: every faithfulness-gate decision
#
# The research results depend on this being logged from the first day the gate
# exists, not added later. One row per claim per verification pass. `output_id`
# groups every claim of one generated output, so claim-level and whole-response
# verification can be run on the same output for the ablation.
# ---------------------------------------------------------------------------
gate_events = Table(
    "gate_events",
    metadata,
    Column("event_id", UUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid()),
    Column("output_id", UUID(as_uuid=True), nullable=False),
    # Regeneration attempt that produced this output, starting at 1.
    Column("attempt", SmallInteger, nullable=False, server_default=text("1")),
    Column("generation_mode", Text, nullable=False),
    Column("granularity", Text, nullable=False),
    Column("retrieval_condition", Text, nullable=False, server_default=text("'normal'")),
    Column("claim_text", Text, nullable=False),
    Column("passage_ids", ARRAY(Text), nullable=False, server_default=text("'{}'")),
    Column("nli_model", Text, nullable=False),
    Column("nli_label", Text),
    Column("nli_score", Float),
    Column("decision", Text, nullable=False),
    Column("latency_ms", Integer, nullable=False),
    Column("created_at", TIMESTAMP(timezone=True), nullable=False, server_default=func.now()),
    CheckConstraint(
        _in("generation_mode", ("tutoring", "practical", "grading")),
        name="ck_gate_events_mode",
    ),
    CheckConstraint(
        _in("granularity", ("claim", "whole_response")), name="ck_gate_events_granularity"
    ),
    CheckConstraint(
        _in("retrieval_condition", ("normal", "degraded")),
        name="ck_gate_events_retrieval_condition",
    ),
    CheckConstraint(_in("decision", ("pass", "block")), name="ck_gate_events_decision"),
    schema=TUTOR_SCHEMA,
)
Index("ix_gate_events_output", gate_events.c.output_id)
Index("ix_gate_events_created", gate_events.c.created_at)
