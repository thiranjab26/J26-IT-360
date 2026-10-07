"""Import the prerequisite graph from `core` into Neo4j.

    uv run python -m scripts.import_graph --dry-run          read and validate only
    uv run python -m scripts.import_graph --version v0        WRITES to Neo4j and Postgres

What a real run does:
  1. Reads concepts and edges from `core` (read-only) and validates them: no
     unknown concepts, no self-loops, no cycles. A broken graph stops here.
  2. Makes Neo4j hold exactly this graph, labelled with --version.
  3. Saves a copy to curriculum.graph_snapshot (the fallback when Neo4j is down).
  4. Writes one row to curriculum.graph_audit recording the import.

Run `uv run alembic upgrade head` first so the curriculum tables exist.
"""

from __future__ import annotations

import argparse
import json
import sys

from sqlalchemy import text

from app.config import get_settings
from app.db.graph_sources import CoreGraphSource, SnapshotRepository
from app.db.neo4j_store import Neo4jGraphStore, create_driver
from app.db.session import get_engine
from app.domain.graph import GraphError, PrerequisiteGraph


def summarise(graph: PrerequisiteGraph) -> str:
    cross = sum(e.cross_module for e in graph.edges)
    depth = max(graph.depth(c.concept_id) for c in graph.concepts)
    modules = ", ".join(
        f"{m}: {sum(c.module_id == m for c in graph.concepts)}" for m in graph.module_ids()
    )
    return (
        f"{len(graph)} concepts ({modules}), {len(graph.edges)} edges "
        f"({cross} cross-module), longest prerequisite chain {depth}, no cycles"
    )


def main() -> int:
    parser = argparse.ArgumentParser(description="Import the core prerequisite graph into Neo4j.")
    parser.add_argument("--version", default="v0", help="graph version label, e.g. v0 or v1")
    parser.add_argument("--dry-run", action="store_true", help="validate only, write nothing")
    args = parser.parse_args()

    settings = get_settings()
    engine = get_engine()

    try:
        core_graph = CoreGraphSource(engine).read()
    except GraphError as exc:
        print(f"The core graph is invalid and was not imported: {exc}", file=sys.stderr)
        return 1
    if core_graph is None:
        print("core.concepts is empty: nothing to import.", file=sys.stderr)
        return 1
    graph = PrerequisiteGraph(core_graph.concepts, core_graph.edges, args.version)
    print("Read from core:", summarise(graph))

    if args.dry_run:
        print("Dry run: nothing written.")
        return 0
    if not settings.neo4j_enabled:
        print(
            "CURRICULUM_NEO4J_URI, _USER and _PASSWORD must be set in .env to import.",
            file=sys.stderr,
        )
        return 1

    driver = create_driver(settings)
    try:
        driver.verify_connectivity()
        removed = Neo4jGraphStore(driver).replace_graph(graph, status="seeded")
    finally:
        driver.close()
    print(f"Neo4j now holds graph {args.version} (removed {removed}).")

    SnapshotRepository(engine).save(graph, source="neo4j")
    with engine.begin() as connection:
        connection.execute(
            text(
                """
                INSERT INTO curriculum.graph_audit (actor, action, graph_version, details)
                VALUES ('import_graph', 'import', :version, CAST(:details AS jsonb))
                """
            ),
            {
                "version": args.version,
                "details": json.dumps(
                    {
                        "source": "core",
                        "concepts": len(graph),
                        "edges": len(graph.edges),
                        "checksum": graph.checksum(),
                        **removed,
                    }
                ),
            },
        )
    print("Snapshot and audit row saved in the curriculum schema.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
