"""C4 courses routes, mounted under /api/v1/viva."""

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import settings
from app.core import limits
from app.core.auth import admin
from app.db.repositories.materials import store_material
from app.db.session import get_db
from app.db.tables import Course, Material, User
from app.models.schemas import CourseIn, MaterialTextIn

router = APIRouter()


@router.post("/courses", status_code=201)
def create_course(body: CourseIn, user: User = Depends(admin), db: Session = Depends(get_db)):
    if not body.name.strip():
        raise HTTPException(422, "Enter a course name.")
    course = Course(
        name=body.name.strip(), description=body.description.strip(), created_by=user.id
    )
    db.add(course)
    db.commit()
    return {"id": course.id, "name": course.name, "description": course.description}


@router.get("/courses")
def list_courses(user: User = Depends(admin), db: Session = Depends(get_db)):
    return {
        "items": [
            {
                "id": c.id,
                "name": c.name,
                "description": c.description,
                "materials": [
                    {"id": m.id, "name": m.name, "chunk_count": len(m.chunks)}
                    for m in db.scalars(select(Material).where(Material.course_id == c.id))
                ],
            }
            for c in db.scalars(select(Course).order_by(Course.created_at))
        ]
    }


@router.post("/courses/{course_id}/materials/text", status_code=201)
def add_text(
    course_id: str, body: MaterialTextIn, user: User = Depends(admin), db: Session = Depends(get_db)
):
    name = body.name if body.name.lower().endswith((".txt", ".md")) else body.name + ".txt"
    item, duplicate = store_material(db, course_id, body.text.encode("utf-8"), name)
    db.commit()
    return {
        "id": item.id,
        "name": item.name,
        "chunk_count": len(item.chunks),
        "duplicate": duplicate,
    }


@router.get("/courses/{course_id}/materials/{material_id}")
def material_preview(
    course_id: str, material_id: str, user: User = Depends(admin), db: Session = Depends(get_db)
):
    item = db.get(Material, material_id)
    if not item or item.course_id != course_id:
        raise HTTPException(404, "Course material not found.")
    return {"id": item.id, "name": item.name, "chunks": item.chunks}


@router.post("/courses/{course_id}/materials", status_code=201)
def upload_material(
    course_id: str,
    file: UploadFile = File(...),
    user: User = Depends(admin),
    db: Session = Depends(get_db),
):
    try:
        content = file.file.read(settings().max_material_bytes + 1)
        item, duplicate = store_material(db, course_id, content, file.filename)
        db.commit()
        return {
            "id": item.id,
            "name": item.name,
            "chunk_count": len(item.chunks),
            "duplicate": duplicate,
        }
    finally:
        file.file.close()


@router.get("/usage")
def usage(user: User = Depends(admin)):
    cfg = settings()
    return {
        "counters": limits.usage(),
        "limits": {
            "llm_daily_calls": cfg.llm_daily_calls,
            "llm_user_daily_calls": cfg.llm_user_daily_calls,
            "llm_daily_token_budget": cfg.llm_daily_token_budget,
            "llm_requests_per_minute": cfg.llm_requests_per_minute,
            "speech_daily_calls": cfg.speech_daily_calls,
        },
        "notes": "Daily limits reset at 00:00 UTC. Token units reserve UTF-8 request bytes plus maximum output tokens; failed attempts remain charged.",
    }
