"""Hide the old built-in sample topics (Stacks, Queues, Object-oriented programming, Databases)
from students: their approved questions are marked rejected, so the topics drop off the topic list.

    uv run python scripts/hide_sample_topics.py           show what would change
    uv run python scripts/hide_sample_topics.py --apply   back up the database, then hide them

Undo: approve the questions again in the lecturer Question bank, or restore the backup.
"""

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import select  # noqa: E402

from app.db.session import SessionLocal  # noqa: E402
from app.db.tables import Bank  # noqa: E402
from app.integrations.context import TOPICS  # noqa: E402
from scripts.load_c3_bank import BACKUPS, backup  # noqa: E402


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--apply", action="store_true", help="back up, then hide the sample topics")
    args = ap.parse_args()
    with SessionLocal() as db:
        rows = db.scalars(select(Bank).where(Bank.topic_id.in_(TOPICS), Bank.status == "approved")).all()
        for topic in sorted({r.topic_id for r in rows}):
            print(f"{TOPICS[topic][0]}: {sum(r.topic_id == topic for r in rows)} approved question(s)")
        if not rows:
            print("No approved sample questions: nothing to hide.")
            return
        if not args.apply:
            print("Dry run. Add --apply to back up and hide them.")
            return
        path, _ = backup(db, BACKUPS)
        print(f"Backup: {path}")
        for r in rows:
            r.status = "rejected"
        db.commit()
        print(f"Hidden {len(rows)} question(s); the sample topics no longer show to students.")


if __name__ == "__main__":
    main()
