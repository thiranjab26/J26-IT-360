"""C4 admin overview for the staff dashboard, mounted under /api/v1/viva.

Read-only aggregates over the viva schema. Admin only: evaluators stay blinded to
system outcomes, so they never see this view.
"""

from collections import Counter
from datetime import UTC, datetime, timedelta
from statistics import mean

from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.auth import admin
from app.db.session import get_db
from app.db.tables import Bank, Course, HumanRating, User, VivaSession

router = APIRouter()

STATES = ("complete", "partial", "superficial", "incorrect", "misconception_bearing", "non_answer")
DAYS = 14


def day(value):
    return (value or "")[:10]


@router.get("/overview")
def overview(user: User = Depends(admin), db: Session = Depends(get_db)):
    sessions = list(db.scalars(select(VivaSession)))
    codes = {
        u.id: u.participant_code for u in db.scalars(select(User).where(User.role == "participant"))
    }
    bank = dict(db.execute(select(Bank.status, func.count()).group_by(Bank.status)).all())
    ratings = list(db.execute(select(HumanRating.rater_id)).scalars())

    completed = [s for s in sessions if s.status == "completed"]
    reports = [s.data.get("report") or {} for s in completed]
    turns = [t for s in sessions for t in s.data.get("turns", [])]
    answered = [t for t in turns if not t.get("skipped")]
    outcomes = Counter(
        "STRONG" if r.get("strong_answers") else r.get("outcome", "MIXED_INSUFFICIENT_EVIDENCE")
        for r in reports
    )
    states = Counter(t["assessment"]["state"] for t in answered)
    coverage = [r["rubric_coverage"] for r in reports if r.get("rubric_coverage") is not None]
    durations = []
    for s in completed:
        try:
            start = datetime.fromisoformat(s.data["created_at"])
            end = datetime.fromisoformat(s.data["completed_at"])
            durations.append((end - start).total_seconds() / 60)
        except (KeyError, TypeError, ValueError):
            pass

    today = datetime.now(UTC).date()
    days = [(today - timedelta(days=i)).isoformat() for i in range(DAYS - 1, -1, -1)]
    started = Counter(day(s.data.get("created_at")) for s in sessions)
    finished = Counter(day(s.data.get("completed_at")) for s in completed)

    topics = {}
    for s in sessions:
        entry = topics.setdefault(
            s.data.get("topic", "Unknown"), {"sessions": 0, "completed": 0, "coverage": []}
        )
        entry["sessions"] += 1
        if s.status == "completed":
            entry["completed"] += 1
            value = (s.data.get("report") or {}).get("rubric_coverage")
            if value is not None:
                entry["coverage"].append(value)

    recent = sorted(sessions, key=lambda s: s.data.get("created_at", ""), reverse=True)[:8]
    return {
        "generated_at": datetime.now(UTC).isoformat(),
        "totals": {
            "participants": len(codes),
            "sessions": len(sessions),
            "completed": len(completed),
            "active": sum(s.status == "active" for s in sessions),
            "answers": len(answered),
            "skipped": len(turns) - len(answered),
            "spoken_answers": sum(t.get("input_mode") == "speech" for t in answered),
            "typed_answers": sum(t.get("input_mode") != "speech" for t in answered),
            "average_coverage": round(mean(coverage), 1) if coverage else None,
            "average_minutes": round(mean(durations), 1) if durations else None,
        },
        "bank": {
            "approved": bank.get("approved", 0),
            "draft": bank.get("draft", 0),
            "rejected": bank.get("rejected", 0),
            "courses": db.scalar(select(func.count()).select_from(Course)) or 0,
        },
        "ratings": {"total": len(ratings), "raters": len(set(ratings))},
        "outcomes": {
            key: outcomes.get(key, 0)
            for key in (
                "STRONG",
                "LIKELY_KNOWLEDGE_GAP",
                "LIKELY_COMMUNICATION_DIFFICULTY",
                "MIXED_INSUFFICIENT_EVIDENCE",
            )
        },
        "answer_states": {state: states.get(state, 0) for state in STATES},
        "daily": [
            {"date": d, "started": started.get(d, 0), "completed": finished.get(d, 0)} for d in days
        ],
        "topics": sorted(
            (
                {
                    "topic": name,
                    "sessions": v["sessions"],
                    "completed": v["completed"],
                    "average_coverage": round(mean(v["coverage"]), 1) if v["coverage"] else None,
                }
                for name, v in topics.items()
            ),
            key=lambda t: -t["sessions"],
        ),
        "recent": [
            {
                "id": s.id,
                "participant_code": codes.get(s.user_id, "unknown"),
                "topic": s.data.get("topic"),
                "status": s.status,
                "created_at": s.data.get("created_at"),
                "answers": sum(not t.get("skipped") for t in s.data.get("turns", [])),
                "outcome": (s.data.get("report") or {}).get("outcome"),
                "strong": bool((s.data.get("report") or {}).get("strong_answers")),
                "coverage": (s.data.get("report") or {}).get("rubric_coverage"),
            }
            for s in recent
        ],
    }
