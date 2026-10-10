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
    Boolean,
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
from sqlalchemy.dialects.postgresql import JSONB, UUID

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

# ---------------------------------------------------------------------------
# tutor.sessions: one row per guided session
#
# The session state machine is plain data, so the row stores exactly its fields and a
# session can be rebuilt from it. `steps` is the plan (a JSON list of {kind, ref,
# gating}) frozen at the start, so editing the course mid-session cannot move the
# ground under a student who is partway through.
# ---------------------------------------------------------------------------
SESSION_PHASES = ("hook", "teach", "checkpoint", "feedback", "reteach", "ended")
EXIT_REASONS = (
    "completed",
    "mastery_satisfied",
    "struggling",
    "load_exit",
    "student_ended",
    "timeout",
)

sessions = Table(
    "sessions",
    metadata,
    Column(
        "session_id", UUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid()
    ),
    # A plain UUID, not a foreign key: users belong to `core`, which this service reads
    # but does not constrain against. The gateway has already authenticated the caller.
    Column("user_id", UUID(as_uuid=True), nullable=False),
    Column("module_id", Text, nullable=False),
    Column("concept_id", Text, nullable=False),
    # The unlock policy this session was started under, kept so a later change to the
    # setting cannot alter a session already in progress.
    Column("policy", Text, nullable=False),
    Column("steps", JSONB, nullable=False),
    Column("step_index", Integer, nullable=False, server_default=text("0")),
    Column("phase", Text, nullable=False),
    Column("attempts", SmallInteger, nullable=False, server_default=text("0")),
    Column("last_outcome", Text),
    Column("passed", ARRAY(Text), nullable=False, server_default=text("'{}'")),
    Column("passed_gating", ARRAY(Text), nullable=False, server_default=text("'{}'")),
    Column("exit_reason", Text),
    Column("started_at", TIMESTAMP(timezone=True), nullable=False, server_default=func.now()),
    Column("last_activity_at", TIMESTAMP(timezone=True), nullable=False, server_default=func.now()),
    Column("ended_at", TIMESTAMP(timezone=True)),
    CheckConstraint(_in("phase", SESSION_PHASES), name="ck_sessions_phase"),
    CheckConstraint(
        "exit_reason IS NULL OR " + _in("exit_reason", EXIT_REASONS), name="ck_sessions_exit"
    ),
    CheckConstraint(_in("policy", ("mastery_gated", "points_only")), name="ck_sessions_policy"),
    CheckConstraint(
        "(phase = 'ended') = (ended_at IS NOT NULL)", name="ck_sessions_ended_consistent"
    ),
    schema=TUTOR_SCHEMA,
)
# A student is in at most one session at a time, and the database enforces it: two
# near-simultaneous "start" requests (a double click) cannot both succeed. This index
# also makes "is this student mid-session?" cheap.
Index(
    "uq_sessions_one_active_per_user",
    sessions.c.user_id,
    unique=True,
    postgresql_where=sessions.c.ended_at.is_(None),
)
Index("ix_sessions_user_started", sessions.c.user_id, sessions.c.started_at)

# ---------------------------------------------------------------------------
# tutor.checkpoint_attempts: every answer a student gave, marked
#
# This is the evidence behind XP, the stand-in mastery estimate and the published view
# `tutor.v_attempt_outcomes` that C1 reads. An unreadable answer is recorded too, with
# outcome 'unreadable', but it is not an attempt: it never counts and never reaches C1.
# ---------------------------------------------------------------------------
checkpoint_attempts = Table(
    "checkpoint_attempts",
    metadata,
    Column(
        "attempt_id", UUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid()
    ),
    Column(
        "session_id",
        UUID(as_uuid=True),
        ForeignKey(f"{TUTOR_SCHEMA}.sessions.session_id", ondelete="CASCADE"),
        nullable=False,
    ),
    Column("question_id", Text, nullable=False),
    Column("concept_id", Text, nullable=False),
    Column("kind", Text, nullable=False),
    Column("gating", Boolean, nullable=False),
    # Which try on this question this was, starting at 1. Unreadable answers repeat the
    # number of the try they did not use up.
    Column("attempt_no", SmallInteger, nullable=False),
    Column("answer", Text, nullable=False),
    Column("outcome", Text, nullable=False),
    Column("reason", Text, nullable=False, server_default=text("''")),
    Column("xp", Integer, nullable=False, server_default=text("0")),
    Column("hints_used", SmallInteger, nullable=False, server_default=text("0")),
    Column("created_at", TIMESTAMP(timezone=True), nullable=False, server_default=func.now()),
    CheckConstraint(_in("outcome", ("correct", "wrong", "unreadable")), name="ck_attempts_outcome"),
    CheckConstraint("xp >= 0", name="ck_attempts_xp"),
    schema=TUTOR_SCHEMA,
)
Index("ix_attempts_session", checkpoint_attempts.c.session_id, checkpoint_attempts.c.created_at)
Index("ix_attempts_concept", checkpoint_attempts.c.concept_id)

# The published view (contracts/views/tutor.v_attempt_outcomes.md). It is created by the
# migration rather than declared here, because a view is not a table. Gating checkpoints
# only: a pulse check is a recall check that, by design, is not evidence of mastery.
ATTEMPT_OUTCOMES_VIEW = f"""
CREATE VIEW {TUTOR_SCHEMA}.v_attempt_outcomes AS
SELECT s.user_id,
       a.concept_id,
       a.question_id AS item_id,
       (a.outcome = 'correct') AS correct,
       a.hints_used,
       a.created_at AS attempted_at
  FROM {TUTOR_SCHEMA}.checkpoint_attempts a
  JOIN {TUTOR_SCHEMA}.sessions s USING (session_id)
 WHERE a.gating
   AND a.outcome IN ('correct', 'wrong')
"""
