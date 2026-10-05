"""Seed core.modules, core.topics, core.concepts and core.concept_prerequisites
from the agreed CSV files in this folder.

Idempotent: re-running upserts rows rather than duplicating them, so it is safe
to run after every change to the CSVs.

Usage, from the repository root, with DATABASE_URL set (or database/.env present):

    python database/seed/seed_concepts.py
    python database/seed/seed_concepts.py --dry-run      # validate CSVs only

Modules are declared below rather than in the CSVs, because a module has a name
and a code that the per-concept rows have no place to carry.
"""

from __future__ import annotations

import argparse
import csv
import os
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path

from sqlalchemy import create_engine, text
from sqlalchemy.engine import Engine

SEED_DIR = Path(__file__).resolve().parent
DATABASE_DIR = SEED_DIR.parent
REPO_ROOT = DATABASE_DIR.parent

# module_id -> (code, display name, description, ordering, status)
#
# `code` is the university's course code and is left unset until the real codes
# are confirmed, so the UI never shows a made-up one.
#
# `status` is `available` once the module's course content is authored and
# indexed, and `coming_soon` until then. The concept list for a coming-soon
# module is still seeded, because C1's graph needs the concept IDs and the
# cross-module prerequisites to resolve.
MODULES: dict[str, tuple[str | None, str, str, int, str]] = {
    "prog": (
        None,
        "Programming Fundamentals in Java",
        "Variables, control flow, methods, arrays and objects in Java 21, ending with "
        "tracing programs by hand.",
        1,
        "available",
    ),
    "dsa": (
        None,
        "Data Structures and Algorithms",
        "Complexity analysis, linear structures, recursion, trees and sorting.",
        2,
        "coming_soon",
    ),
}

CSV_FILES = ("concepts_programming.csv", "concepts_dsa.csv")


@dataclass
class Concept:
    concept_id: str
    module_id: str
    topic_id: str
    topic_name: str
    name: str
    description: str | None
    position: int
    prerequisites: list[tuple[str, bool]] = field(default_factory=list)


def slugify(value: str) -> str:
    """Control Flow -> control_flow. Topic IDs are module scoped."""
    slug = re.sub(r"[^a-z0-9]+", "_", value.strip().lower())
    return slug.strip("_")


def load_env() -> None:
    """Load database/.env then the repo-root .env, without overriding real env vars."""
    for candidate in (DATABASE_DIR / ".env", REPO_ROOT / ".env"):
        if not candidate.exists():
            continue
        for line in candidate.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            os.environ.setdefault(key.strip(), value.strip().strip("\"").strip("'"))


def database_url() -> str:
    url = os.environ.get("CORE_DATABASE_URL") or os.environ.get("DATABASE_URL")
    if not url:
        sys.exit(
            "DATABASE_URL is not set. Copy database/.env.example to database/.env "
            "and paste your Neon connection string."
        )
    if url.startswith("postgresql://"):
        url = url.replace("postgresql://", "postgresql+psycopg://", 1)
    return url


def read_concepts() -> list[Concept]:
    """Parse every CSV into Concept rows, preserving file order as position."""
    concepts: list[Concept] = []
    topic_seen: dict[str, int] = {}

    for filename in CSV_FILES:
        path = SEED_DIR / filename
        if not path.exists():
            sys.exit(f"Missing seed file: {path}")

        with path.open(newline="", encoding="utf-8-sig") as handle:
            for index, row in enumerate(csv.DictReader(handle), start=1):
                concept_id = (row["concept_id"] or "").strip()
                if not concept_id:
                    continue

                module_id = (row["module_id"] or "").strip()
                if module_id not in MODULES:
                    sys.exit(
                        f"{filename} row {index}: module_id {module_id!r} is not declared "
                        f"in MODULES (known: {', '.join(MODULES)})"
                    )

                topic_name = (row["topic"] or "").strip()
                topic_id = f"{module_id}.{slugify(topic_name)}"
                topic_seen.setdefault(topic_id, len(topic_seen) + 1)

                prerequisites: list[tuple[str, bool]] = []
                for column, cross in (
                    ("prerequisites_same_module", False),
                    ("prerequisites_cross_module", True),
                ):
                    raw = (row.get(column) or "").strip()
                    if not raw:
                        continue
                    for prerequisite in raw.split(";"):
                        prerequisite = prerequisite.strip()
                        if prerequisite:
                            prerequisites.append((prerequisite, cross))

                concepts.append(
                    Concept(
                        concept_id=concept_id,
                        module_id=module_id,
                        topic_id=topic_id,
                        topic_name=topic_name,
                        name=(row["name"] or "").strip(),
                        description=(row.get("description") or "").strip() or None,
                        position=index,
                        prerequisites=prerequisites,
                    )
                )

    return concepts


def validate(concepts: list[Concept]) -> None:
    """Fail loudly on duplicate or dangling concept IDs before touching the database."""
    counts: dict[str, int] = {}
    for concept in concepts:
        counts[concept.concept_id] = counts.get(concept.concept_id, 0) + 1
    duplicates = sorted(cid for cid, count in counts.items() if count > 1)
    if duplicates:
        sys.exit(f"Duplicate concept_id values across the seed files: {', '.join(duplicates)}")

    known = set(counts)
    dangling = sorted(
        {
            f"{c.concept_id} -> {prerequisite}"
            for c in concepts
            for prerequisite, _ in c.prerequisites
            if prerequisite not in known
        }
    )
    if dangling:
        sys.exit(
            "Prerequisites referencing unknown concept IDs:\n  "
            + "\n  ".join(dangling)
            + "\nEvery prerequisite must be a concept_id present in the seed files."
        )


def seed(engine: Engine, concepts: list[Concept]) -> None:
    topics: dict[str, tuple[str, str, int]] = {}
    for concept in concepts:
        if concept.topic_id not in topics:
            topics[concept.topic_id] = (concept.module_id, concept.topic_name, len(topics) + 1)

    edges = [
        {"concept_id": c.concept_id, "prerequisite_id": prerequisite, "cross_module": cross}
        for c in concepts
        for prerequisite, cross in c.prerequisites
    ]

    with engine.begin() as connection:
        connection.execute(
            text(
                """
                INSERT INTO core.modules (module_id, code, name, description, position, status)
                VALUES (:module_id, :code, :name, :description, :position, :status)
                ON CONFLICT (module_id) DO UPDATE SET
                    code        = EXCLUDED.code,
                    name        = EXCLUDED.name,
                    description = EXCLUDED.description,
                    position    = EXCLUDED.position,
                    status      = EXCLUDED.status
                """
            ),
            [
                {
                    "module_id": module_id,
                    "code": code,
                    "name": name,
                    "description": description,
                    "position": position,
                    "status": status,
                }
                for module_id, (code, name, description, position, status) in MODULES.items()
            ],
        )

        connection.execute(
            text(
                """
                INSERT INTO core.topics (topic_id, module_id, name, position)
                VALUES (:topic_id, :module_id, :name, :position)
                ON CONFLICT (topic_id) DO UPDATE SET
                    module_id = EXCLUDED.module_id,
                    name      = EXCLUDED.name,
                    position  = EXCLUDED.position
                """
            ),
            [
                {"topic_id": topic_id, "module_id": module_id, "name": name, "position": position}
                for topic_id, (module_id, name, position) in topics.items()
            ],
        )

        connection.execute(
            text(
                """
                INSERT INTO core.concepts
                    (concept_id, module_id, topic_id, name, description, position)
                VALUES
                    (:concept_id, :module_id, :topic_id, :name, :description, :position)
                ON CONFLICT (concept_id) DO UPDATE SET
                    module_id   = EXCLUDED.module_id,
                    topic_id    = EXCLUDED.topic_id,
                    name        = EXCLUDED.name,
                    description = EXCLUDED.description,
                    position    = EXCLUDED.position
                """
            ),
            [
                {
                    "concept_id": c.concept_id,
                    "module_id": c.module_id,
                    "topic_id": c.topic_id,
                    "name": c.name,
                    "description": c.description,
                    "position": c.position,
                }
                for c in concepts
            ],
        )

        # Prerequisites are replaced wholesale: the CSV is the source of truth, so
        # an edge deleted there must disappear here too.
        connection.execute(text("DELETE FROM core.concept_prerequisites"))

        # Likewise, a concept or topic dropped from the CSVs is removed, after the
        # edges that reference it are gone. A renamed concept would otherwise
        # linger next to its replacement.
        removed_concepts = connection.execute(
            text("DELETE FROM core.concepts WHERE concept_id <> ALL(:keep)"),
            {"keep": [c.concept_id for c in concepts]},
        ).rowcount
        removed_topics = connection.execute(
            text("DELETE FROM core.topics WHERE topic_id <> ALL(:keep)"),
            {"keep": list(topics)},
        ).rowcount
        if edges:
            connection.execute(
                text(
                    """
                    INSERT INTO core.concept_prerequisites
                        (concept_id, prerequisite_id, cross_module)
                    VALUES (:concept_id, :prerequisite_id, :cross_module)
                    """
                ),
                edges,
            )

    print(
        f"Seeded {len(MODULES)} modules, {len(topics)} topics, "
        f"{len(concepts)} concepts, {len(edges)} prerequisite edges."
    )
    if removed_concepts or removed_topics:
        print(f"Pruned {removed_concepts} stale concepts and {removed_topics} stale topics.")


def main() -> None:
    parser = argparse.ArgumentParser(description="Seed core reference data from the seed CSVs.")
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Parse and validate the CSV files without writing to the database.",
    )
    args = parser.parse_args()

    concepts = read_concepts()
    validate(concepts)

    if args.dry_run:
        by_module: dict[str, int] = {}
        topics: set[str] = set()
        for concept in concepts:
            by_module[concept.module_id] = by_module.get(concept.module_id, 0) + 1
            topics.add(concept.topic_id)
        print("Seed files are valid.")
        for module_id, count in by_module.items():
            print(f"  {module_id}: {count} concepts ({MODULES[module_id][1]})")
        print(f"  {len(topics)} topics")
        print(f"  {sum(len(c.prerequisites) for c in concepts)} prerequisite edges, all resolvable")
        return

    load_env()
    seed(create_engine(database_url(), future=True), concepts)


if __name__ == "__main__":
    main()
