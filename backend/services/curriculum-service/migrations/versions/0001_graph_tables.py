"""curriculum: prerequisite graph snapshot and audit log

graph_snapshot  last good copy of the Neo4j graph, one row per distinct version,
                so recommendations keep working when Neo4j is unreachable (NFR-05)
graph_audit     every change to the graph: who, when, what (NFR-11, and the
                evidence trail for the lecturer validation in Objective 1)

Revision ID: 0001_graph
Revises:
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0001_graph"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

SCHEMA = "curriculum"


def upgrade() -> None:
    op.create_table(
        "graph_snapshot",
        sa.Column("snapshot_id", sa.BigInteger(), sa.Identity(), primary_key=True),
        sa.Column("graph_version", sa.Text(), nullable=False),
        sa.Column("source", sa.Text(), nullable=False),
        sa.Column("checksum", sa.Text(), nullable=False),
        sa.Column("concepts", postgresql.JSONB(), nullable=False),
        sa.Column("edges", postgresql.JSONB(), nullable=False),
        sa.Column(
            "created_at",
            sa.TIMESTAMP(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        schema=SCHEMA,
    )

    op.create_table(
        "graph_audit",
        sa.Column("audit_id", sa.BigInteger(), sa.Identity(), primary_key=True),
        sa.Column(
            "changed_at",
            sa.TIMESTAMP(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        # A user id for lecturer edits, or a script name such as 'import_graph'.
        sa.Column("actor", sa.Text(), nullable=False),
        sa.Column("action", sa.Text(), nullable=False),
        sa.Column("concept_id", sa.Text(), nullable=True),
        sa.Column("prerequisite_id", sa.Text(), nullable=True),
        sa.Column("graph_version", sa.Text(), nullable=False),
        sa.Column("details", postgresql.JSONB(), nullable=False, server_default="{}"),
        sa.CheckConstraint(
            "action IN ('import', 'add_edge', 'remove_edge', 'update_edge')",
            name="ck_graph_audit_action",
        ),
        schema=SCHEMA,
    )
    op.create_index("ix_graph_audit_changed_at", "graph_audit", ["changed_at"], schema=SCHEMA)


def downgrade() -> None:
    op.drop_index("ix_graph_audit_changed_at", table_name="graph_audit", schema=SCHEMA)
    op.drop_table("graph_audit", schema=SCHEMA)
    op.drop_table("graph_snapshot", schema=SCHEMA)
