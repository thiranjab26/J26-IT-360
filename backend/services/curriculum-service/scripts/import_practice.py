"""Import practice questions (C3 stand-in) from a JSON bank into curriculum.practice_item.

    uv run python -m scripts.import_practice item_bank/practice.json --dry-run   validate only
    uv run python -m scripts.import_practice item_bank/practice.json             WRITES to Postgres

Format: {"version": "...", "items": [{"item_id", "concept_id", "stem", "options",
"answer_index", "hint" (optional)}]}; item_bank/practice_example.json shows it.
Items are added or updated by item_id. Practice evidence keeps only the item id and
the outcome, so updating a question never changes mastery already computed.
--retire-missing retires items of the same concepts that the file no longer lists.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from sqlalchemy import text

from app.db.graph_sources import CoreGraphSource
from app.db.session import get_engine
from app.domain.practice import PracticeItem


def read_bank(path: Path) -> tuple[str, list[PracticeItem]]:
    data = json.loads(path.read_text(encoding="utf-8"))
    return data["version"], [
        PracticeItem(
            item_id=i["item_id"],
            concept_id=i["concept_id"],
            stem=i["stem"],
            options=tuple(i["options"]),
            answer_index=i["answer_index"],
            hint=i.get("hint"),
        )
        for i in data["items"]
    ]


def check(items: list[PracticeItem], known: set[str]) -> list[str]:
    problems, seen = [], set()
    for item in items:
        if item.item_id in seen:
            problems.append(f"{item.item_id}: item id used twice")
        seen.add(item.item_id)
        if item.concept_id not in known:
            problems.append(f"{item.item_id}: unknown concept {item.concept_id}")
        if len(item.options) < 2 or len(set(item.options)) != len(item.options):
            problems.append(f"{item.item_id}: needs at least 2 distinct options")
        if not 0 <= item.answer_index < len(item.options):
            problems.append(f"{item.item_id}: answer_index out of range")
    return problems


def main() -> int:
    parser = argparse.ArgumentParser(description="Import practice questions from a JSON bank.")
    parser.add_argument("bank", type=Path)
    parser.add_argument("--dry-run", action="store_true", help="validate only, write nothing")
    parser.add_argument("--retire-missing", action="store_true")
    args = parser.parse_args()

    try:
        version, items = read_bank(args.bank)
    except (OSError, KeyError, TypeError, ValueError) as exc:
        print(f"Could not read {args.bank}: {exc!r}", file=sys.stderr)
        return 1

    engine = get_engine()
    core = CoreGraphSource(engine).read()
    problems = check(items, {c.concept_id for c in core.concepts} if core else set())
    if problems:
        print("The practice bank was not imported:", file=sys.stderr)
        for problem in problems:
            print(f"  - {problem}", file=sys.stderr)
        return 1
    concepts = sorted({i.concept_id for i in items})
    print(f"{len(items)} practice items over {len(concepts)} concepts")
    if args.dry_run:
        print(f"Bank {version} is valid. Dry run: nothing written.")
        return 0

    with engine.begin() as connection:
        connection.execute(
            text(
                """
                INSERT INTO curriculum.practice_item
                    (item_id, concept_id, stem, options, answer_index, hint, retired,
                     bank_version, updated_at)
                VALUES (:item_id, :concept_id, :stem, CAST(:options AS jsonb), :answer_index,
                        :hint, false, :version, now())
                ON CONFLICT (item_id) DO UPDATE
                SET concept_id = EXCLUDED.concept_id, stem = EXCLUDED.stem,
                    options = EXCLUDED.options, answer_index = EXCLUDED.answer_index,
                    hint = EXCLUDED.hint, retired = false,
                    bank_version = EXCLUDED.bank_version, updated_at = now()
                """
            ),
            [
                {
                    "item_id": i.item_id,
                    "concept_id": i.concept_id,
                    "stem": i.stem,
                    "options": json.dumps(list(i.options)),
                    "answer_index": i.answer_index,
                    "hint": i.hint,
                    "version": version,
                }
                for i in items
            ],
        )
        if args.retire_missing:
            retired = connection.execute(
                text(
                    "UPDATE curriculum.practice_item SET retired = true, updated_at = now()"
                    " WHERE concept_id = ANY(:concepts) AND NOT (item_id = ANY(:ids))"
                    " AND NOT retired"
                ),
                {"concepts": concepts, "ids": [i.item_id for i in items]},
            ).rowcount
            print(f"Retired {retired} items no longer in the bank.")
    print(f"Imported practice bank {version}.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
