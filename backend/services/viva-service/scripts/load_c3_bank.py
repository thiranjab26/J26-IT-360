"""Load the C3 catalogue questions (app/domain/c3_bank.py) into the viva bank.

    uv run python scripts/load_c3_bank.py             dry run: what would be removed and added
    uv run python scripts/load_c3_bank.py --update    back up, then refresh the C3 questions in
                                                      place; sessions and people stay
    uv run python scripts/load_c3_bank.py --apply     back up, then replace everything

--apply removes every session (with its turns, results, events and ratings), every participant
with their sign-in tokens, every course with its materials, and every question; staff stay.
Both write every row of every viva table to a JSON backup outside the repository first
(default: Intelligent Viva System/C4-db-backups), named in Sri Lanka time.
"""

import argparse
import json
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import func, select  # noqa: E402

from app.db.session import SessionLocal  # noqa: E402
from app.db.tables import Base, User  # noqa: E402
from app.domain.c3_bank import build, replace_bank, update_bank  # noqa: E402

SRI_LANKA = timezone(timedelta(hours=5, minutes=30))
BACKUPS = Path(__file__).resolve().parents[5] / "C4-db-backups"


def backup(db, folder):
    folder.mkdir(parents=True, exist_ok=True)
    path = folder / f"viva-backup-{datetime.now(SRI_LANKA):%Y-%m-%d-%H%M}.json"
    dump = {}
    for table in Base.metadata.sorted_tables:
        rows = db.execute(select(table)).mappings().all()
        dump[table.name] = [dict(r) for r in rows]
    path.write_text(json.dumps(dump, indent=1, default=str), encoding="utf-8")
    return path, {name: len(rows) for name, rows in dump.items()}


def main():
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    mode = ap.add_mutually_exclusive_group()
    mode.add_argument("--apply", action="store_true", help="back up, then replace everything")
    mode.add_argument("--update", action="store_true", help="back up, then refresh in place")
    ap.add_argument("--backup-dir", type=Path, default=BACKUPS)
    a = ap.parse_args()
    bank = build()
    with SessionLocal() as db:
        if a.update:
            path, saved = backup(db, a.backup_dir)
            print(f"Backup: {path} ({sum(saved.values())} rows)")
            refreshed = update_bank(db)
            print("Refreshed:", ", ".join(f"{k} {v}" for k, v in refreshed.items()))
            return
        counts = {
            t.name: db.scalar(select(func.count()).select_from(t))
            for t in Base.metadata.sorted_tables
        }
        participants = db.scalar(
            select(func.count()).select_from(User).where(User.role == "participant")
        )
        print("Now in the database:", ", ".join(f"{k} {v}" for k, v in counts.items()))
        print(
            f"Would remove: {counts['viva_sessions']} sessions, {participants} participants, "
            f"{counts['courses']} courses, {counts['generated_question_bank']} questions (staff stay)"
        )
        print(
            f"Would add: {len(bank)} C3 courses, {sum(len(c['questions']) for c in bank)} approved questions"
        )
        for c in bank:
            n = len(c["questions"])
            print(f"  {c['course']['name']}: {n} question{'s' if n != 1 else ''}")
        if not a.apply:
            print("Dry run: nothing changed. --update refreshes in place; --apply replaces.")
            return
        path, saved = backup(db, a.backup_dir)
        print(f"Backup: {path} ({sum(saved.values())} rows)")
        removed, added = replace_bank(db)
        print("Removed:", ", ".join(f"{k} {v}" for k, v in removed.items()))
        print("Added:", ", ".join(f"{k} {v}" for k, v in added.items()))


if __name__ == "__main__":
    main()
