"""Command line for the course content.

    uv run python -m app.content.cli check            parse, chunk, validate; no writes
    uv run python -m app.content.cli check --no-db    same, without the database checks
    uv run python -m app.content.cli sync             check, then write units and chunks
    uv run python -m app.content.cli index            sync, then embed the chunks into ChromaDB

`check` is the dry run: it is what to run after editing a markdown file. By default
it also compares against core.concepts and core.concept_prerequisites, because a
concept ID the rest of the platform has never heard of is the mistake that matters.

Exit status is 1 if any error was found, 2 if the database could not be reached.
"""

from __future__ import annotations

import argparse
import sys
from collections import Counter, defaultdict

from sqlalchemy import Engine, create_engine, text
from sqlalchemy.exc import OperationalError

from app.config import get_settings
from app.content.chunker import chunk_unit
from app.content.loader import ContentError, load_content
from app.content.models import INDEXED_SECTION_TYPES, Chunk, Unit
from app.content.validate import Issue, validate
from app.db.repositories import content as repo


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="app.content.cli", description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)

    for name, help_text in (
        ("check", "parse, chunk and validate the content without writing"),
        ("sync", "validate, then write units and chunks to the database"),
        ("index", "sync, then embed the chunks into ChromaDB (incremental)"),
    ):
        command = sub.add_parser(name, help=help_text)
        command.add_argument("--module", help="only this module, e.g. prog")
        if name == "check":
            command.add_argument(
                "--no-db", action="store_true", help="skip the checks that need the database"
            )

    args = parser.parse_args(argv)
    settings = get_settings()

    try:
        units = load_content(settings.content_root, args.module)
    except ContentError as exc:
        print(f"ERROR   {exc}")
        return 1

    if not units:
        print(f"No content found under {settings.content_root}")
        return 1

    chunks_by_unit = {unit.unit_id: chunk_unit(unit) for unit in units}

    known_concepts: set[str] | None = None
    known_edges: dict[str, set[str]] | None = None
    engine: Engine | None = None

    if args.command in ("sync", "index") or not args.no_db:
        engine = create_engine(settings.migration_database_url or settings.database_url)
        try:
            known_concepts, known_edges = _core_reference(engine)
        except OperationalError as exc:
            print(f"Could not reach the database: {str(exc.orig).splitlines()[0]}")
            print("Use `check --no-db` to validate the files without it.")
            return 2

    issues = validate(units, chunks_by_unit, known_concepts=known_concepts, known_edges=known_edges)
    _report(units, chunks_by_unit, issues, checked_db=known_concepts is not None)

    errors = [i for i in issues if i.severity == "error"]
    if errors:
        suffix = " Nothing was written." if args.command != "check" else ""
        print(f"\n{len(errors)} error(s).{suffix}")
        return 1

    if args.command == "check":
        return 0

    assert engine is not None
    _sync(engine, units, chunks_by_unit)

    if args.command == "index":
        _embed(settings, units, chunks_by_unit)
    return 0


# ---------------------------------------------------------------------------
def _core_reference(engine: Engine) -> tuple[set[str], dict[str, set[str]]]:
    """Concept IDs and prerequisite edges as the rest of the platform sees them."""
    with engine.connect() as conn:
        concepts = {r[0] for r in conn.execute(text("SELECT concept_id FROM core.concepts"))}
        edges: dict[str, set[str]] = defaultdict(set)
        for concept_id, prerequisite_id in conn.execute(
            text("SELECT concept_id, prerequisite_id FROM core.concept_prerequisites")
        ):
            edges[concept_id].add(prerequisite_id)
    return concepts, dict(edges)


def _report(
    units: list[Unit],
    chunks_by_unit: dict[str, list[Chunk]],
    issues: list[Issue],
    *,
    checked_db: bool,
) -> None:
    modules = sorted({u.module_id for u in units})
    for module in modules:
        module_units = [u for u in units if u.module_id == module]
        counts: Counter[str] = Counter()
        words = 0
        for unit in module_units:
            for chunk in chunks_by_unit[unit.unit_id]:
                counts[chunk.section_type] += 1
                words += chunk.word_count

        statuses = Counter(u.status for u in module_units)
        print(
            f"\n{module}: {len(module_units)} units, {sum(counts.values())} chunks, {words} words"
        )
        print("  status: " + ", ".join(f"{n} {s}" for s, n in sorted(statuses.items())))
        for section in INDEXED_SECTION_TYPES:
            if counts[section]:
                print(f"  {section:<14}{counts[section]:>5}")

    print(
        "\ndatabase checks: "
        + ("concept IDs and prerequisites compared with core" if checked_db else "skipped")
    )
    if issues:
        print()
        for issue in issues:
            print(issue)
    else:
        print("no issues")


def _sync(engine: Engine, units: list[Unit], chunks_by_unit: dict[str, list[Chunk]]) -> None:
    results: Counter[str] = Counter()
    modules = sorted({u.module_id for u in units})

    # One transaction: a failure part way through leaves the database as it was.
    with engine.begin() as conn:
        for unit in units:
            outcome = repo.replace_unit(conn, unit, chunks_by_unit[unit.unit_id])
            results[outcome] += 1
            if outcome != repo.UNCHANGED:
                print(f"  {outcome:<9} {unit.unit_id} ({len(chunks_by_unit[unit.unit_id])} chunks)")

        # Only prune modules we actually scanned, so syncing one module never
        # deletes another's.
        for module in modules:
            keep = [u.unit_id for u in units if u.module_id == module]
            for removed in repo.prune_units(conn, module, keep):
                results["removed"] += 1
                print(f"  removed   {removed}")

    summary = ", ".join(f"{n} {name}" for name, n in sorted(results.items()))
    print(f"\nsynced: {summary}")


def _embed(settings, units: list[Unit], chunks_by_unit: dict[str, list[Chunk]]) -> None:  # noqa: ANN001
    # Imported here: loading torch takes seconds and `check` and `sync` never need it.
    from app.content.embedder import SentenceTransformerEmbedder
    from app.content.indexer import index_module, open_store, truncated_chunks

    embedder = SentenceTransformerEmbedder(settings.embedding_model)
    client = open_store(settings.chroma_root)
    print(f"\nembedding with {embedder.name} (reads {embedder.max_tokens} tokens per chunk)")

    for module in sorted({u.module_id for u in units}):
        chunks = [c for u in units if u.module_id == module for c in chunks_by_unit[u.unit_id]]

        cut_off = truncated_chunks(embedder, chunks)
        if cut_off:
            print(f"WARNING {len(cut_off)} chunk(s) are longer than the model reads, so their")
            print("        ends are not searchable. Shorten them or use a longer-window model:")
            for chunk, tokens in sorted(cut_off, key=lambda item: -item[1])[:5]:
                print(f"        {chunk.chunk_id} ({tokens} tokens)")

        result = index_module(client, embedder, module, chunks)
        print(
            f"  {result.collection}: {result.added} added, {result.updated} updated, "
            f"{result.unchanged} unchanged, {result.removed} removed "
            f"({result.seconds:.1f}s)"
        )


if __name__ == "__main__":
    sys.exit(main())
