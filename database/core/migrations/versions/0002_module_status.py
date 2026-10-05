"""core: module availability

A module is `available` once its course content is authored and indexed, and
`coming_soon` until then. The dashboard reads this to decide whether a module
can be opened, so the flag lives with the module rather than in any one service.

Additive and defaulted, so existing readers of core.modules are unaffected.

Revision ID: 0002_module_status
Revises: 0001_core
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0002_module_status"
down_revision: Union[str, None] = "0001_core"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

SCHEMA = "core"


def upgrade() -> None:
    op.add_column(
        "modules",
        sa.Column("status", sa.Text(), nullable=False, server_default="coming_soon"),
        schema=SCHEMA,
    )
    op.create_check_constraint(
        "ck_modules_status",
        "modules",
        "status IN ('available', 'coming_soon')",
        schema=SCHEMA,
    )


def downgrade() -> None:
    op.drop_constraint("ck_modules_status", "modules", schema=SCHEMA, type_="check")
    op.drop_column("modules", "status", schema=SCHEMA)
