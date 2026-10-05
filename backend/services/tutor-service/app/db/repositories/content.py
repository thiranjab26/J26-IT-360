"""Reading and writing content.units and content.chunks.

Takes a SQLAlchemy Connection so the caller decides the transaction: the sync
command wraps the whole run in one, so a failure part way leaves nothing half
written.
"""

from __future__ import annotations

from collections.abc import Collection, Sequence

from sqlalchemy import Connection, delete, func, insert, select
from sqlalchemy.dialects.postgresql import insert as pg_insert

from app.content.models import Chunk, Unit
from app.db.tables import chunks, units

CREATED = "created"
UPDATED = "updated"
UNCHANGED = "unchanged"


def replace_unit(conn: Connection, unit: Unit, unit_chunks: Sequence[Chunk]) -> str:
    """Make the database match this unit. Returns created, updated or unchanged.

    A unit is unchanged when its file hash and chunk count both match, so syncing an
    unedited course writes nothing. Otherwise its chunks are replaced wholesale:
    chunk boundaries move when content is edited, so patching them one by one would
    be more code for no benefit.
    """
    existing_hash = conn.execute(
        select(units.c.content_hash).where(units.c.unit_id == unit.unit_id)
    ).scalar_one_or_none()
    existing_chunks = conn.execute(
        select(func.count()).select_from(chunks).where(chunks.c.unit_id == unit.unit_id)
    ).scalar_one()

    if existing_hash == unit.content_hash and existing_chunks == len(unit_chunks):
        return UNCHANGED

    row = {
        "unit_id": unit.unit_id,
        "module_id": unit.module_id,
        "concept_id": unit.concept_id,
        "kind": unit.kind,
        "sequence": unit.sequence,
        "topic": unit.topic,
        "title": unit.title,
        "difficulty": unit.difficulty,
        "prerequisites": list(unit.prerequisites),
        "cross_module_prerequisites": list(unit.cross_module_prerequisites),
        "java_version": unit.java_version,
        "version": unit.version,
        "status": unit.status,
        "source_path": unit.source_path,
        "content_hash": unit.content_hash,
    }

    conn.execute(delete(chunks).where(chunks.c.unit_id == unit.unit_id))
    statement = pg_insert(units).values(**row)
    conn.execute(
        statement.on_conflict_do_update(
            index_elements=[units.c.unit_id],
            set_={**{k: v for k, v in row.items() if k != "unit_id"}, "synced_at": func.now()},
        )
    )
    if unit_chunks:
        conn.execute(insert(chunks), [_chunk_row(c) for c in unit_chunks])

    return UPDATED if existing_hash else CREATED


def prune_units(conn: Connection, module_id: str, keep_unit_ids: Collection[str]) -> list[str]:
    """Remove units of a module whose file no longer exists. Chunks go with them."""
    statement = delete(units).where(units.c.module_id == module_id)
    if keep_unit_ids:
        statement = statement.where(units.c.unit_id.not_in(list(keep_unit_ids)))
    result = conn.execute(statement.returning(units.c.unit_id))
    return [r[0] for r in result]


def count_by_section(conn: Connection, module_id: str | None = None) -> dict[str, int]:
    statement = select(chunks.c.section_type, func.count()).group_by(chunks.c.section_type)
    if module_id:
        statement = statement.where(chunks.c.module_id == module_id)
    return {section: count for section, count in conn.execute(statement)}


def _chunk_row(chunk: Chunk) -> dict:
    return {
        "chunk_id": chunk.chunk_id,
        "unit_id": chunk.unit_id,
        "module_id": chunk.module_id,
        "concept_id": chunk.concept_id,
        "section_type": chunk.section_type,
        "ordinal": chunk.ordinal,
        "heading_path": chunk.heading_path,
        "headings": list(chunk.headings),
        "question_nos": list(chunk.question_nos) if chunk.question_nos else None,
        "level": chunk.level,
        "text": chunk.text,
        "word_count": chunk.word_count,
        "text_hash": chunk.text_hash,
    }
