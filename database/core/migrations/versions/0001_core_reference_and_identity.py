"""core: identity and shared reference data

Creates the tables every component reads:
  roles, users                       identity, written by auth-service
  modules, topics, concepts          the shared curriculum vocabulary
  concept_prerequisites              prerequisite edges as seeded from CSV

Concept IDs are the join key between C3's content and C1's graph, so they are
defined once here and seeded from database/seed/*.csv. Nobody invents one.

Revision ID: 0001_core
Revises:
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0001_core"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

SCHEMA = "core"


def upgrade() -> None:
    op.execute(f"CREATE SCHEMA IF NOT EXISTS {SCHEMA}")
    op.execute("CREATE EXTENSION IF NOT EXISTS pgcrypto")

    # ---------------------------------------------------------------- roles
    op.create_table(
        "roles",
        sa.Column("role", sa.Text(), primary_key=True),
        sa.Column("description", sa.Text(), nullable=False),
        schema=SCHEMA,
    )
    op.bulk_insert(
        sa.table(
            "roles",
            sa.column("role", sa.Text),
            sa.column("description", sa.Text),
            schema=SCHEMA,
        ),
        [
            {"role": "student", "description": "Learner. Takes tutoring sessions and vivas."},
            {"role": "lecturer", "description": "Instructor. Authors content and reviews cohort progress."},
            {"role": "admin", "description": "Platform administrator."},
        ],
    )

    # ---------------------------------------------------------------- users
    op.create_table(
        "users",
        sa.Column(
            "user_id",
            sa.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column("email", sa.Text(), nullable=False),
        sa.Column("password_hash", sa.Text(), nullable=False),
        sa.Column("full_name", sa.Text(), nullable=False),
        sa.Column("role", sa.Text(), nullable=False),
        # Set for students only; lecturers have no index number.
        sa.Column("student_number", sa.Text(), nullable=True),
        # Set for lecturers only; the department they teach in.
        sa.Column("department", sa.Text(), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column(
            "created_at",
            sa.TIMESTAMP(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "updated_at",
            sa.TIMESTAMP(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.ForeignKeyConstraint(["role"], [f"{SCHEMA}.roles.role"], name="fk_users_role"),
        schema=SCHEMA,
    )
    # Email is the login identifier: unique regardless of the case it was typed in.
    op.create_index(
        "uq_users_email_lower",
        "users",
        [sa.text("lower(email)")],
        unique=True,
        schema=SCHEMA,
    )
    op.create_index(
        "uq_users_student_number",
        "users",
        ["student_number"],
        unique=True,
        schema=SCHEMA,
        postgresql_where=sa.text("student_number IS NOT NULL"),
    )

    # -------------------------------------------------------------- modules
    op.create_table(
        "modules",
        sa.Column("module_id", sa.Text(), primary_key=True),
        sa.Column("code", sa.Text(), nullable=True),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("position", sa.Integer(), nullable=False, server_default="0"),
        schema=SCHEMA,
    )

    # --------------------------------------------------------------- topics
    op.create_table(
        "topics",
        sa.Column("topic_id", sa.Text(), primary_key=True),
        sa.Column("module_id", sa.Text(), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False, server_default="0"),
        sa.ForeignKeyConstraint(
            ["module_id"], [f"{SCHEMA}.modules.module_id"], name="fk_topics_module"
        ),
        schema=SCHEMA,
    )
    op.create_index("ix_topics_module", "topics", ["module_id"], schema=SCHEMA)

    # ------------------------------------------------------------- concepts
    op.create_table(
        "concepts",
        sa.Column("concept_id", sa.Text(), primary_key=True),
        sa.Column("module_id", sa.Text(), nullable=False),
        sa.Column("topic_id", sa.Text(), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("position", sa.Integer(), nullable=False, server_default="0"),
        sa.ForeignKeyConstraint(
            ["module_id"], [f"{SCHEMA}.modules.module_id"], name="fk_concepts_module"
        ),
        sa.ForeignKeyConstraint(
            ["topic_id"], [f"{SCHEMA}.topics.topic_id"], name="fk_concepts_topic"
        ),
        schema=SCHEMA,
    )
    op.create_index("ix_concepts_module", "concepts", ["module_id"], schema=SCHEMA)
    op.create_index("ix_concepts_topic", "concepts", ["topic_id"], schema=SCHEMA)

    # ------------------------------------------------ concept prerequisites
    # C1 owns the authoritative prerequisite graph in Neo4j. This table is the
    # seeded starting point both C1 and C3 read from, so the CSV stays the
    # single source of truth for the agreed edges.
    op.create_table(
        "concept_prerequisites",
        sa.Column("concept_id", sa.Text(), nullable=False),
        sa.Column("prerequisite_id", sa.Text(), nullable=False),
        sa.Column("cross_module", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.PrimaryKeyConstraint("concept_id", "prerequisite_id", name="pk_concept_prerequisites"),
        sa.ForeignKeyConstraint(
            ["concept_id"], [f"{SCHEMA}.concepts.concept_id"], name="fk_prereq_concept"
        ),
        sa.ForeignKeyConstraint(
            ["prerequisite_id"],
            [f"{SCHEMA}.concepts.concept_id"],
            name="fk_prereq_prerequisite",
        ),
        sa.CheckConstraint("concept_id <> prerequisite_id", name="ck_prereq_not_self"),
        schema=SCHEMA,
    )
    op.create_index(
        "ix_prereq_prerequisite", "concept_prerequisites", ["prerequisite_id"], schema=SCHEMA
    )


def downgrade() -> None:
    op.drop_table("concept_prerequisites", schema=SCHEMA)
    op.drop_table("concepts", schema=SCHEMA)
    op.drop_table("topics", schema=SCHEMA)
    op.drop_table("modules", schema=SCHEMA)
    op.drop_table("users", schema=SCHEMA)
    op.drop_table("roles", schema=SCHEMA)
