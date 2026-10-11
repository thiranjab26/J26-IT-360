"""curriculum: test paper lifecycle (draft, published, locked) and versions

Revision ID: 0005_paper_versions
Revises: 0004_practice

Existing papers become version 1, published; any paper a learner has started
becomes locked. Downgrade works only while every form still has one version.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0005_paper_versions"
down_revision: str | None = "0004_practice"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

SCHEMA = "curriculum"
TABLE = "test_paper"


def upgrade() -> None:
    op.add_column(
        TABLE,
        sa.Column("version", sa.SmallInteger(), nullable=False, server_default="1"),
        schema=SCHEMA,
    )
    # Default 'published' keeps scripts/import_tests.py working unchanged.
    op.add_column(
        TABLE,
        sa.Column("status", sa.Text(), nullable=False, server_default="published"),
        schema=SCHEMA,
    )
    op.add_column(
        TABLE, sa.Column("published_at", sa.TIMESTAMP(timezone=True), nullable=True), schema=SCHEMA
    )
    op.add_column(
        TABLE, sa.Column("locked_at", sa.TIMESTAMP(timezone=True), nullable=True), schema=SCHEMA
    )
    op.add_column(TABLE, sa.Column("updated_by", postgresql.UUID(), nullable=True), schema=SCHEMA)
    op.add_column(
        TABLE,
        sa.Column(
            "updated_at",
            sa.TIMESTAMP(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        schema=SCHEMA,
    )
    op.execute(f"UPDATE {SCHEMA}.{TABLE} SET published_at = imported_at")
    op.execute(
        f"""
        UPDATE {SCHEMA}.{TABLE} AS p SET status = 'locked', locked_at = now()
        WHERE EXISTS (SELECT 1 FROM {SCHEMA}.test_attempt AS a WHERE a.paper_id = p.paper_id)
        """
    )
    op.create_check_constraint(
        "ck_test_paper_status", TABLE, "status IN ('draft', 'published', 'locked')", schema=SCHEMA
    )
    op.create_check_constraint("ck_test_paper_version", TABLE, "version >= 1", schema=SCHEMA)
    op.drop_constraint("uq_test_paper_module_form", TABLE, schema=SCHEMA, type_="unique")
    op.create_unique_constraint(
        "uq_test_paper_module_form_version", TABLE, ["module_id", "form", "version"], schema=SCHEMA
    )
    # At most one draft per form at a time.
    op.create_index(
        "uq_test_paper_one_draft",
        TABLE,
        ["module_id", "form"],
        unique=True,
        schema=SCHEMA,
        postgresql_where=sa.text("status = 'draft'"),
    )


def downgrade() -> None:
    op.drop_index("uq_test_paper_one_draft", table_name=TABLE, schema=SCHEMA)
    op.drop_constraint("uq_test_paper_module_form_version", TABLE, schema=SCHEMA, type_="unique")
    op.create_unique_constraint(
        "uq_test_paper_module_form", TABLE, ["module_id", "form"], schema=SCHEMA
    )
    op.drop_constraint("ck_test_paper_version", TABLE, schema=SCHEMA, type_="check")
    op.drop_constraint("ck_test_paper_status", TABLE, schema=SCHEMA, type_="check")
    for column in ("updated_at", "updated_by", "locked_at", "published_at", "status", "version"):
        op.drop_column(TABLE, column, schema=SCHEMA)
