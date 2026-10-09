"""Import pre/post test papers from a JSON item bank into curriculum.test_paper / test_item.

    uv run python -m scripts.import_tests item_bank/dsa.json --dry-run    validate only
    uv run python -m scripts.import_tests item_bank/dsa.json              WRITES to Postgres

Item banks hold answer keys, so they live in item_bank/ (gitignored) and never in
git; item_bank/example.json shows the format. A paper that already has attempts
is never replaced, because that would change a test some learners have taken.

Checks before anything is written: forms A and B per module, 24 main items each
(--main-items to change), every concept exists in `core`, twins point at each
other and cover the same concepts, answer indexes are in range.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from sqlalchemy import text

from app.db.assessment_store import paper_rows
from app.db.graph_sources import CoreGraphSource
from app.db.session import get_engine
from app.domain.assessment import MAIN_ITEMS_PER_PAPER, Item, Paper, check_bank


def read_bank(path: Path) -> tuple[str, list[Paper]]:
    data = json.loads(path.read_text(encoding="utf-8"))
    papers = [
        Paper(
            paper_id=p["paper_id"],
            module_id=p["module_id"],
            form=p["form"],
            title=p["title"],
            items=tuple(
                Item(
                    item_id=i["item_id"],
                    position=position,
                    concept_id=i["concept_id"],
                    section=i.get("section", "main"),
                    stem=i["stem"],
                    options=tuple(i["options"]),
                    answer_index=i["answer_index"],
                    twin_item_id=i.get("twin_item_id"),
                )
                for position, i in enumerate(p["items"], start=1)
            ),
        )
        for p in data["papers"]
    ]
    return data["version"], papers


def main() -> int:
    parser = argparse.ArgumentParser(description="Import test papers from a JSON item bank.")
    parser.add_argument("bank", type=Path)
    parser.add_argument("--main-items", type=int, default=MAIN_ITEMS_PER_PAPER)
    parser.add_argument("--dry-run", action="store_true", help="validate only, write nothing")
    args = parser.parse_args()

    try:
        version, papers = read_bank(args.bank)
    except (OSError, KeyError, TypeError, ValueError) as exc:
        print(f"Could not read {args.bank}: {exc!r}", file=sys.stderr)
        return 1

    engine = get_engine()
    core = CoreGraphSource(engine).read()
    known = {c.concept_id for c in core.concepts} if core else set()
    problems = check_bank(papers, known, args.main_items)
    if problems:
        print("The item bank was not imported:", file=sys.stderr)
        for problem in problems:
            print(f"  - {problem}", file=sys.stderr)
        return 1

    for paper in papers:
        sections = [i.section for i in paper.items]
        print(
            f"{paper.paper_id}: {sections.count('main')} main + "
            f"{sections.count('prereq')} prerequisite items"
        )
    if args.dry_run:
        print(f"Bank {version} is valid. Dry run: nothing written.")
        return 0

    with engine.begin() as connection:
        ids = [p.paper_id for p in papers]
        taken = (
            connection.execute(
                text(
                    "SELECT DISTINCT paper_id FROM curriculum.test_attempt"
                    " WHERE paper_id = ANY(:ids)"
                ),
                {"ids": ids},
            )
            .scalars()
            .all()
        )
        if taken:
            print(f"Not imported: learners have already sat {sorted(taken)}.", file=sys.stderr)
            return 1
        # Items cascade with their paper.
        connection.execute(
            text("DELETE FROM curriculum.test_paper WHERE paper_id = ANY(:ids)"), {"ids": ids}
        )
        for paper in papers:
            paper_row, item_rows = paper_rows(paper, version)
            connection.execute(
                text(
                    "INSERT INTO curriculum.test_paper"
                    " (paper_id, module_id, form, title, bank_version)"
                    " VALUES (:paper_id, :module_id, :form, :title, :bank_version)"
                ),
                paper_row,
            )
            connection.execute(
                text(
                    """
                    INSERT INTO curriculum.test_item
                        (item_id, paper_id, position, concept_id, section, stem, options,
                         answer_index, twin_item_id)
                    VALUES (:item_id, :paper_id, :position, :concept_id, :section, :stem,
                            CAST(:options AS jsonb), :answer_index, :twin_item_id)
                    """
                ),
                item_rows,
            )
    print(f"Imported bank {version}: {len(papers)} papers.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
