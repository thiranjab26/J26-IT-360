"""C4 evaluation routes, mounted under /api/v1/viva."""

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import JSONResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.auth import admin, digest, researcher
from app.db.session import get_db
from app.db.tables import HumanRating, User, VivaSession, uid
from app.domain import research
from app.models.schemas import Condition, RatingIn

router = APIRouter()


@router.get("/evaluation/cases")
def evaluation_cases(
    condition: Condition = "A", user: User = Depends(researcher), db: Session = Depends(get_db)
):
    return {"items": research.cases(db, condition, user.id)}


@router.post("/evaluation/ratings")
def rating(body: RatingIn, user: User = Depends(researcher), db: Session = Depends(get_db)):
    if research.prediction(db, body.case_id, body.condition) is None:
        raise HTTPException(404, "Completed case not found.")
    if body.condition == "A" and body.follow_up_appropriateness is not None:
        raise HTTPException(422, "Condition A exposes no follow-ups to rate.")
    record = db.scalar(
        select(HumanRating).where(
            HumanRating.case_id == body.case_id,
            HumanRating.condition == body.condition,
            HumanRating.rater_id == user.id,
        )
    )
    payload = body.model_dump(exclude={"case_id", "condition"})
    if record:
        record.data = payload
    else:
        record = HumanRating(
            id=uid(), rater_id=user.id, case_id=body.case_id, condition=body.condition, data=payload
        )
        db.add(record)
    db.commit()
    return {"id": record.id}


@router.get("/evaluation/metrics")
def evaluation_metrics(user: User = Depends(admin), db: Session = Depends(get_db)):
    return research.metrics(db)


@router.get("/evaluation/export")
def evaluation_export(user: User = Depends(admin), db: Session = Depends(get_db)):
    sessions = list(db.scalars(select(VivaSession).where(VivaSession.status == "completed")))
    rows = []
    for session in sessions:
        for index, bank in enumerate(session.data["snapshots"]):
            case_id = f"{session.id}:{index}"
            turns = [t for t in session.data["turns"] if t["concept_index"] == index]
            if turns:
                rows.append(
                    {
                        "case_id": case_id,
                        "topic": session.data["topic"],
                        "concept": bank["concept"],
                        "turns": turns,
                        "c01_mastery": session.data["integration_context"]["c01"],
                        "predictions": {
                            c: research.prediction(db, case_id, c) for c in ("A", "B", "C")
                        },
                        "policy_version": session.data["policy_version"],
                        "gap_version": session.data["gap_version"],
                    }
                )
    ratings = [
        {
            "rater_code": digest(r.rater_id)[:16],
            "case_id": r.case_id,
            "condition": r.condition,
            **r.data,
        }
        for r in db.scalars(select(HumanRating))
    ]
    return JSONResponse(
        {
            "cases": rows,
            "ratings": ratings,
            "metrics": research.metrics(db),
            "privacy_note": "Pseudonymized export; free-text transcripts/notes may contain voluntarily entered identifying information. Review before sharing.",
        },
        headers={"Content-Disposition": 'attachment; filename="viva-research.json"'},
    )
