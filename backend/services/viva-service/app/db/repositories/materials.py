"""Local course authoring alongside the existing C03 integration."""

import hashlib
import io
import re

from fastapi import HTTPException
from sqlalchemy import select

from app.config import settings
from app.db.tables import Course, Material, uid
from app.integrations.context import TOPICS, adapter


def topic_catalog(db):
    return {**TOPICS, **{c.id: (c.name, c.id, c.description) for c in db.scalars(select(Course))}}


def extract_material(content, filename):
    cfg = settings()
    if len(content) > cfg.max_material_bytes:
        raise HTTPException(413, "Material exceeds the upload size limit.")
    filename = re.split(r"[/\\]", filename or "material.txt")[-1][:200]
    pages = []
    if filename.lower().endswith(".pdf"):
        if not content.startswith(b"%PDF-"):
            raise HTTPException(422, "This file is not a valid PDF.")
        try:
            from pypdf import PdfReader

            reader = PdfReader(io.BytesIO(content))
            if reader.is_encrypted:
                raise HTTPException(422, "Upload an unencrypted PDF.")
            if len(reader.pages) > 100:
                raise HTTPException(413, "PDFs are limited to 100 pages.")
            total = 0
            for number, page in enumerate(reader.pages, 1):
                text = page.extract_text() or ""
                total += len(text)
                if total > cfg.max_material_chars:
                    raise HTTPException(413, "Extracted material exceeds the text limit.")
                pages.append((number, text))
        except HTTPException:
            raise
        except Exception as exc:
            raise HTTPException(
                422, "PDF could not be read. Export a text-based PDF or upload UTF-8 text."
            ) from exc
    elif filename.lower().endswith((".txt", ".md")):
        try:
            pages = [(None, content.decode("utf-8-sig"))]
        except UnicodeDecodeError as exc:
            raise HTTPException(422, "Text files must use UTF-8 encoding.") from exc
    else:
        raise HTTPException(415, "Upload a .txt, .md, or text-based .pdf file.")
    if sum(len(t) for _, t in pages) > cfg.max_material_chars:
        raise HTTPException(413, "Material exceeds the extracted text limit.")
    material_id = uid()
    chunks = []
    for page, text in pages:
        text = re.sub(r"\s+", " ", text.replace("\x00", "")).strip()
        # Overlap preserves sentences crossing a chunk boundary; page provenance remains exact.
        for start in range(0, len(text), 1400):
            part = text[start : start + 1600]
            if part.strip():
                chunks.append(
                    {
                        "chunk_id": f"{material_id}:{len(chunks) + 1}",
                        "source": filename,
                        "page": page,
                        "text": part,
                    }
                )
    if not chunks or sum(len(c["text"]) for c in chunks) < 40:
        raise HTTPException(
            422,
            "No usable text found. Scanned PDFs need OCR before upload; add at least 40 characters of course content.",
        )
    return material_id, filename, chunks


def store_material(db, course_id, content, filename):
    if not db.get(Course, course_id):
        raise HTTPException(404, "Course not found.")
    digest = hashlib.sha256(content).hexdigest()
    existing = db.scalar(
        select(Material).where(Material.course_id == course_id, Material.digest == digest)
    )
    if existing:
        return existing, True
    if len(list(db.scalars(select(Material.id).where(Material.course_id == course_id)))) >= 20:
        raise HTTPException(409, "Each course supports up to 20 materials.")
    material_id, name, chunks = extract_material(content, filename)
    item = Material(id=material_id, course_id=course_id, digest=digest, name=name, chunks=chunks)
    db.add(item)
    try:
        db.flush()
    except Exception as exc:
        from sqlalchemy.exc import IntegrityError

        if not isinstance(exc, IntegrityError):
            raise
        db.rollback()
        existing = db.scalar(
            select(Material).where(Material.course_id == course_id, Material.digest == digest)
        )
        if existing:
            return existing, True
        raise
    return item, False


def course_context(db, topic_id, user_id):
    course = db.get(Course, topic_id)
    if not course:
        return adapter.context(topic_id, user_id)
    materials = list(
        db.scalars(select(Material).where(Material.course_id == course.id).order_by(Material.id))
    )
    chunks = [c for m in materials for c in m.chunks]
    # Rank by course title/description; bounded excerpts prevent unbounded provider payloads.
    terms = set(re.findall(r"\w+", (course.name + " " + course.description).lower()))
    ranked = sorted(chunks, key=lambda c: -len(terms & set(re.findall(r"\w+", c["text"].lower()))))[
        :12
    ]
    return {
        "c01": {
            "topic": course.name,
            "mastery": 0,
            "confidence": 0,
            "starting_difficulty": "unknown",
            "source": "mock unavailable for uploaded course; no independent evidence",
        },
        "c02": {
            "cognitive_load": "medium",
            "frustration": "unknown",
            "engagement": "unknown",
            "source": "mock unavailable for uploaded course; no diagnostic evidence",
        },
        "c03": {
            "course_id": course.id,
            "topic": course.name,
            "chunks": ranked,
            "review_resources": [{"title": m.name, "resource_id": m.id} for m in materials],
            "source": "local uploaded course materials",
            "total_chunks": len(chunks),
            "selected_chunks": len(ranked),
        },
    }


def norm(text):
    """Typography-insensitive comparison: quote styles, dashes, case, whitespace and edge punctuation."""
    # Escapes keep typographic characters out of the source (repo rule: no em dashes).
    quotes_and_dashes = {
        "\u2018": "'",
        "\u2019": "'",
        "\u201c": '"',
        "\u201d": '"',
        "\u2013": "-",
        "\u2014": "-",
        "\u00a0": " ",
    }
    text = (text or "").translate(str.maketrans(quotes_and_dashes))
    return " ".join(text.casefold().split()).strip(" .,;:")


def validate_grounding(item, context, required=False):
    chunks = context["c03"]["chunks"]
    sources = item["sources"]
    for source in sources:
        matches = [
            c
            for c in chunks
            if c["source"] == source["source"]
            and c.get("page") == source.get("page")
            and (not source.get("chunk_id") or c.get("chunk_id") == source["chunk_id"])
        ]
        quote = norm(source.get("text"))
        holding = [c for c in matches if quote and quote in norm(c["text"])]
        if required and not source.get("chunk_id") and any(c.get("chunk_id") for c in holding):
            source["chunk_id"] = holding[0][
                "chunk_id"
            ]  # Repair an omitted ID from the chunk that holds the quote.
        if not matches or (required and not quote) or (quote and not holding):
            raise ValueError(
                f"Source quote is not an excerpt of the cited course chunk ({source['source']}, page {source.get('page')})."
            )
    if required:
        for point in item["rubric_points"]:
            evidence = point.get("evidence_quote") or ""
            refs = point.get("source_indices", [])
            if not refs or not evidence or any(i < 0 or i >= len(sources) for i in refs):
                raise ValueError(
                    "Every rubric point needs valid source_indices and an evidence_quote."
                )
            if not any(norm(evidence) in norm(sources[i].get("text")) for i in refs):
                raise ValueError(
                    f'Rubric point "{point["id"]}" evidence_quote is not inside its referenced source text.'
                )
            if not point.get("probe"):
                raise ValueError("Every generated rubric point needs a non-leading probe.")
