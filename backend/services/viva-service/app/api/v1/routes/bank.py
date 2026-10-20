"""C4 bank routes, mounted under /api/v1/viva."""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.v1.routes.common import valid_topic
from app.core.auth import admin
from app.db.repositories.materials import (
    course_context,
    validate_grounding,
)
from app.db.session import get_db
from app.db.tables import Bank, Course, Material, Turn, User, uid
from app.integrations.llm import generate
from app.models.schemas import BankQuestion, GenerateIn, QuestionContent, ReviewIn

router = APIRouter()
WRITTEN = "lecturer_written"


@router.get("/bank")
def bank_list(
    status: str = "all",
    topic_id: str | None = None,
    user: User = Depends(admin),
    db: Session = Depends(get_db),
):
    if status not in ("all", "draft", "approved", "rejected"):
        raise HTTPException(422, "Unknown bank status.")
    query = select(Bank)
    if status != "all":
        query = query.where(Bank.status == status)
    if topic_id:
        valid_topic(topic_id)
        query = query.where(Bank.topic_id == topic_id)
    return {"items": [q.data for q in db.scalars(query.order_by(Bank.id))]}


@router.post("/bank/generate", status_code=201)
def bank_generate(body: GenerateIn, user: User = Depends(admin), db: Session = Depends(get_db)):
    valid_topic(body.topic_id)
    context = course_context(db, body.topic_id, user.id)
    if not context["c03"]["chunks"]:
        raise HTTPException(409, "Upload course material before generating questions.")
    items, provider = generate(body.topic_id, body.count, context)
    result = []
    for item in items:
        item.update(
            id=uid(), status="draft", origin=f"{provider}_generated", review_notes=None, version=1
        )
        validated = BankQuestion.model_validate(item).model_dump()
        db.add(Bank(id=item["id"], topic_id=item["topic_id"], status="draft", data=validated))
        result.append(validated)
    db.commit()
    return {"items": result, "provider": provider}


@router.post("/bank", status_code=201)
def bank_write(body: dict, user: User = Depends(admin), db: Session = Depends(get_db)):
    """A question the lecturer writes by hand; it waits for review like a generated one."""
    item = {k: v for k, v in body.items() if k in QuestionContent.model_fields or k == "review_notes"}
    item.update(id=uid(), status="draft", origin=WRITTEN, version=1)
    item.setdefault("sources", [{"source": "Written by the lecturer"}])
    try:
        result = BankQuestion.model_validate(item).model_dump()
    except ValueError:
        raise HTTPException(422, "Question fields do not match the bank schema. Check rubric and follow-ups.") from None
    valid_topic(result["topic_id"])
    db.add(Bank(id=result["id"], topic_id=result["topic_id"], status="draft", data=result))
    db.commit()
    return result


@router.delete("/bank/{question_id}", status_code=204)
def bank_delete(question_id: str, user: User = Depends(admin), db: Session = Depends(get_db)):
    bank = db.get(Bank, question_id)
    if bank is None:
        raise HTTPException(404, "Bank item not found.")
    if bank.status == "approved":
        raise HTTPException(409, "Approved questions cannot be deleted. Reject it first.")
    # Reports keep pointing at the questions they asked.
    if db.scalar(select(Turn.id).where(Turn.question_id == question_id).limit(1)):
        raise HTTPException(409, "This question was used in a viva, so its reports still need it. Reject it instead.")
    db.delete(bank)
    db.commit()


@router.put("/bank/{question_id}")
def bank_edit(
    question_id: str, body: dict, user: User = Depends(admin), db: Session = Depends(get_db)
):
    bank = db.get(Bank, question_id)
    if bank is None:
        raise HTTPException(404, "Bank item not found.")
    allowed = set(BankQuestion.model_fields)
    if set(body) - allowed:
        raise HTTPException(422, "Unknown bank fields.")
    # Accept full BankQuestion or partial edits; approval is always an explicit review action.
    merged = {
        **bank.data,
        **body,
        "id": question_id,
        "origin": bank.data["origin"],
        "status": "draft",
        "version": bank.data["version"] + 1,
    }
    if body.get("version") is not None and body["version"] != bank.data["version"]:
        raise HTTPException(409, "Question was edited by someone else. Reload before editing.")
    try:
        result = BankQuestion.model_validate(merged).model_dump()
    except ValueError:
        raise HTTPException(
            422,
            "Question fields do not match the bank schema. Check rubric, follow-ups and sources.",
        ) from None
    valid_topic(result["topic_id"])
    bank.data, bank.status, bank.topic_id = result, "draft", result["topic_id"]
    db.commit()
    return result


@router.post("/bank/{question_id}/review")
def bank_review(
    question_id: str, body: ReviewIn, user: User = Depends(admin), db: Session = Depends(get_db)
):
    bank = db.get(Bank, question_id)
    if bank is None:
        raise HTTPException(404, "Bank item not found.")
    # The lecturer's own questions need no quote from the material; generated ones must be grounded in it.
    if body.status == "approved" and bank.data["origin"] != WRITTEN and db.get(Course, bank.topic_id):
        try:
            # Check against all immutable material chunks, including excerpts outside current retrieval.
            context = course_context(db, bank.topic_id, user.id)
            context["c03"]["chunks"] = [
                c
                for m in db.scalars(select(Material).where(Material.course_id == bank.topic_id))
                for c in m.chunks
            ]
            validate_grounding(bank.data, context, required=True)
        except ValueError as exc:
            raise HTTPException(422, str(exc)) from exc
    bank.data = {**bank.data, **body.model_dump(), "version": bank.data["version"] + 1}
    bank.status = body.status
    db.commit()
    return bank.data
