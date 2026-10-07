"""Step 1 and 2 of the graph construction: export the current graph for annotation.

Reads core.concepts and core.concept_prerequisites (read-only) and writes:

  concept_inventory.csv  one row per concept, with empty columns to trace each
                         concept to the official module outline
  candidate_edges.csv    one row per prerequisite edge, with empty columns for
                         the justification and strength of each edge

Existing files are never overwritten (your annotations would be lost); pass
--force to regenerate them on purpose.

    uv run --with sqlalchemy --with "psycopg[binary]" python export_graph.py
        --env ../../../backend/services/curriculum-service/.env
"""

from __future__ import annotations

import argparse
import csv
import sys
from pathlib import Path

from sqlalchemy import create_engine, text

HERE = Path(__file__).resolve().parent


def database_url(env_file: Path) -> str:
    for line in env_file.read_text(encoding="utf-8").splitlines():
        if line.startswith("DATABASE_URL"):
            url = line.split("=", 1)[1].strip().strip('"').strip("'")
            return url.replace("postgresql://", "postgresql+psycopg://", 1)
    sys.exit(f"DATABASE_URL not found in {env_file}")


def write(path: Path, rows: list[dict], force: bool) -> None:
    if path.exists() and not force:
        print(f"kept existing {path.name} (use --force to regenerate)")
        return
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)
    print(f"wrote {path.name}: {len(rows)} rows")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--env", type=Path, required=True, help="a .env file with DATABASE_URL")
    parser.add_argument("--force", action="store_true", help="overwrite existing CSVs")
    args = parser.parse_args()

    engine = create_engine(database_url(args.env))
    with engine.connect() as connection:
        concepts = connection.execute(
            text(
                """
                SELECT c.concept_id, c.name, c.module_id, m.name AS module_name,
                       t.name AS topic, c.position, c.description
                FROM core.concepts c
                JOIN core.topics t ON t.topic_id = c.topic_id
                JOIN core.modules m ON m.module_id = c.module_id
                ORDER BY m.position, c.position
                """
            )
        ).mappings().all()
        edges = connection.execute(
            text(
                """
                SELECT e.prerequisite_id, p.name AS prerequisite_name,
                       e.concept_id, c.name AS concept_name, e.cross_module
                FROM core.concept_prerequisites e
                JOIN core.concepts p ON p.concept_id = e.prerequisite_id
                JOIN core.concepts c ON c.concept_id = e.concept_id
                ORDER BY c.module_id DESC, c.position, p.position
                """
            )
        ).mappings().all()

    write(
        HERE / "concept_inventory.csv",
        [
            {
                "concept_id": c["concept_id"],
                "name": c["name"],
                "module": c["module_name"],
                "topic": c["topic"],
                "teaching_position": c["position"],
                "description": c["description"] or "",
                # To fill from the official module outline:
                "syllabus_week": "",
                "source_document": "",
                "learning_outcome": "",
                "notes": "",
            }
            for c in concepts
        ],
        args.force,
    )
    write(
        HERE / "candidate_edges.csv",
        [
            {
                "edge_id": f"E{i:02d}",
                "prerequisite_id": e["prerequisite_id"],
                "prerequisite_name": e["prerequisite_name"],
                "concept_id": e["concept_id"],
                "concept_name": e["concept_name"],
                "cross_module": "yes" if e["cross_module"] else "no",
                "status": "seeded",
                # To fill: essential (cannot learn the concept without it) or helpful.
                "strength": "",
                # To fill: one sentence on why the prerequisite comes first.
                "justification": "",
            }
            for i, e in enumerate(edges, start=1)
        ],
        args.force,
    )


if __name__ == "__main__":
    main()
