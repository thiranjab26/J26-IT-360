"""C4 sessions routes, mounted under /api/v1/viva."""

import hashlib
import json
import re
from copy import deepcopy

from fastapi import (
    APIRouter,
    BackgroundTasks,
    Depends,
    HTTPException,
)
from fastapi.responses import JSONResponse
from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.config import settings
from app.core.auth import current_user, participant
from app.db.repositories.materials import (
    course_context,
    topic_catalog,
)
from app.db.session import get_db
from app.db.tables import Bank, IntegrationEvent, Result, Turn, User, VivaSession, now, uid
from app.domain.logic import (
    GAP_VERSION,
    POLICY_VERSION,
    build_report,
    hesitation,
    issue_question,
    next_question,
    policy,
)
from app.integrations.llm import (
    PURPOSES,
    ProviderUnavailable,
    assess,
    check_phrasing,
    improvement_plan,
    phrase_follow_up,
)
from app.integrations.notifications import deliver_review_notifications
from app.models.schemas import AnswerIn, SessionIn

router = APIRouter()


def owned(db, session_id, user, write=False):
    session = db.get(VivaSession, session_id)
    if not session:
        raise HTTPException(404, "Session not found.")
    if user.role == "evaluator":
        raise HTTPException(403, "Evaluators access only blinded case evidence.")
    if session.user_id != user.id and (user.role != "admin" or write):
        raise HTTPException(403, "You do not own this session.")
    return session


def public_assessment(assessment, completed=False):
    if completed:
        return assessment
    return {
        **assessment,
        "rubric_hits": [],
        "missing_points": [],
        "misconceptions": [],
        "reason": "Response recorded. Detailed rubric feedback is available after completion.",
    }


def session_view(session):
    data = session.data
    current = data["current_question"]
    view = {
        k: data[k]
        for k in (
            "topic_id",
            "topic",
            "input_mode",
            "max_depth",
            "created_at",
            "completed_at",
            "integration_context",
        )
    }
    view.update(
        {
            "id": session.id,
            "status": session.status,
            "current_question": {k: v for k, v in current.items() if not k.startswith("_")}
            if current
            else None,
            "turns": [
                {
                    **{
                        k: t[k]
                        for k in (
                            "id",
                            "question_id",
                            "question",
                            "transcript",
                            "depth",
                            "action",
                            "input_mode",
                            "hesitation",
                            "created_at",
                        )
                    },
                    "state": t["assessment"]["state"],
                    "coverage": t["assessment"]["coverage"],
                }
                for t in data["turns"]
            ],
            "progress": {
                "completed_concepts": len(data["snapshots"])
                if session.status == "completed" and not data.get("ended_early")
                else (current["_concept_index"] if current else data.get("completed_concepts", 0)),
                "total_concepts": len(data["snapshots"]),
            },
        }
    )
    if session.status == "completed":
        view["report"] = data["report"]
    return view


def save_session(db, session, data, status):
    # Compare-and-swap protects a session against concurrent stale submissions across workers.
    result = db.execute(
        update(VivaSession)
        .where(VivaSession.id == session.id, VivaSession.version == session.version)
        .values(data=data, status=status, version=session.version + 1)
        .execution_options(synchronize_session=False)
    )
    if result.rowcount != 1:
        db.rollback()
        raise HTTPException(
            409, "Session changed in another request. Refresh the session and retry."
        )
    session.data = data
    session.status = status
    session.version += 1
    # Prevent ORM from emitting a second unguarded update after the guarded SQL.
    from sqlalchemy.orm.attributes import set_committed_value

    set_committed_value(session, "data", data)
    set_committed_value(session, "status", status)
    set_committed_value(session, "version", session.version)


STOP_INTENT = re.compile(
    r"\b(stop|end|quit|finish|exit)\b.{0,20}\b(session|viva|interview|this|now|here)\b"
    r"|\bi (do not|don t|dont) want to (answer|continue|do this|go on)\b|\bi want to (stop|quit|end|leave)\b|\bno more questions\b"
)


def wants_to_stop(transcript):
    return bool(STOP_INTENT.search(re.sub(r"[^a-z0-9 ]", " ", transcript.lower())))


def llm_wording():
    cfg = settings()
    return cfg.llm_follow_up_phrasing and cfg.assessment_provider != "demo"


def follow_up_plans(data, current, prior):
    """The deterministic action for every possible state, so one LLM call can assess and word the follow-up."""
    bank = data["snapshots"][current["_concept_index"]]
    by_state = {}
    for state in (
        "complete",
        "partial",
        "superficial",
        "incorrect",
        "misconception_bearing",
        "non_answer",
    ):
        action = policy(state, current["depth"], data["max_depth"], prior)
        by_state[state] = {
            "action": action,
            "purpose": PURPOSES.get(action),
            "example_wording": bank["follow_ups"].get(state) if action in PURPOSES else None,
        }
    return {
        "by_state": by_state,
        "already_probed": [t["target_rubric_id"] for t in prior if t.get("target_rubric_id")],
    }


def phrase(data, index, prior, next_q, assessment, transcript, action, draft=None):
    """LLM wording for a policy-selected follow-up; the stored prompt stays as the audited fallback."""
    if not (llm_wording() and next_q["_elicitation_action"] in PURPOSES):
        return {"source": "stored"}
    bank = data["snapshots"][index]
    target = next(
        (p for p in bank["rubric_points"] if p["id"] == next_q.get("_target_rubric_id")), None
    )
    seen = {t["question"].strip().lower() for t in data["turns"] if t["concept_index"] == index}
    if (
        draft
        and draft.get("question")
        and (
            action != "PROBE_MISSING_RUBRIC"
            or draft.get("target_rubric_id") == (target or {}).get("id")
        )
    ):
        text = " ".join(draft["question"].split())
        said = " ".join([t["transcript"] for t in prior] + [transcript])
        if not check_phrasing(text, bank, action, target, said, seen, transcript):
            stored, next_q["question"] = next_q["question"], text
            return {"source": assessment["provider"] + ":combined", "stored_prompt": stored}
    try:
        text, source = phrase_follow_up(bank, action, target, assessment, transcript, prior, seen)
    except (ProviderUnavailable, ValueError, HTTPException) as exc:
        return {
            "source": "stored_fallback",
            "reason": str(getattr(exc, "detail", exc))[:300],
            "stored_prompt": next_q["question"],
        }
    stored, next_q["question"] = next_q["question"], text
    return {"source": source, "stored_prompt": stored}


def complete(db, session, data):
    data["completed_at"] = now()
    data["current_question"] = None
    report = build_report(session.id, data)
    report["plan_provider"] = "rule_based"
    if llm_wording() and data["turns"]:
        try:
            plan, report["plan_provider"] = improvement_plan(report, data)
            report["plan_summary"], report["improvement_plan"] = plan["summary"], plan["steps"]
        except (ProviderUnavailable, ValueError, HTTPException) as exc:
            report["plan_fallback_reason"] = str(getattr(exc, "detail", exc))[:300]
    data["report"] = report
    db.add(Result(session_id=session.id, data=report))
    for event in report["integration_events"]:
        db.add(IntegrationEvent(session_id=session.id, data=event))
    return report


@router.post("/sessions", status_code=201)
def start_session(
    body: SessionIn, user: User = Depends(participant), db: Session = Depends(get_db)
):
    catalog = topic_catalog(db)  # one lookup validates the topic and names it
    if body.topic_id not in catalog:
        raise HTTPException(404, "Topic not found.")
    bank = list(
        db.scalars(
            select(Bank)
            .where(Bank.topic_id == body.topic_id, Bank.status == "approved")
            .order_by(Bank.id)
        )
    )
    # One approved question per concept keeps draft duplicates from lengthening sessions indefinitely.
    selected = {}
    for question in bank:
        selected.setdefault(question.data["concept"].casefold(), question.data)
    if not selected:
        raise HTTPException(409, "No approved questions are available for this topic.")
    snapshots = deepcopy(list(selected.values())[:6])
    context = course_context(db, body.topic_id, user.id)
    # C02 can only reduce interrogation burden; never enters the gap classifier.
    max_depth = (
        min(body.max_depth, 1)
        if context["c02"]["cognitive_load"].lower() == "high"
        else body.max_depth
    )
    data = {
        "topic_id": body.topic_id,
        "topic": catalog[body.topic_id][0],
        "input_mode": body.input_mode,
        "max_depth": max_depth,
        "created_at": now(),
        "completed_at": None,
        "snapshots": snapshots,
        "integration_context": context,
        "turns": [],
        "policy_version": POLICY_VERSION,
        "gap_version": GAP_VERSION,
        "assessment_provider": settings().assessment_provider,
        "provider_model": settings().llm_model
        if settings().assessment_provider != "demo"
        else "demo-phrase-matcher-1",
        "selection_audit": {
            "method": "stable approved first question per concept",
            "question_ids": [q["id"] for q in snapshots],
            "c02_depth_reduced": max_depth != body.max_depth,
        },
        "ended_early": False,
    }
    data["current_question"] = issue_question(data, 0)
    session = VivaSession(id=uid(), user_id=user.id, status="active", data=data)
    db.add(session)
    db.commit()
    return session_view(session)


@router.get("/sessions")
def list_sessions(user: User = Depends(current_user), db: Session = Depends(get_db)):
    if user.role == "evaluator":
        raise HTTPException(403, "Evaluators access only blinded cases.")
    query = select(VivaSession)
    if user.role != "admin":
        query = query.where(VivaSession.user_id == user.id)
    sessions = sorted(db.scalars(query), key=lambda s: s.data["created_at"], reverse=True)
    return {
        "items": [
            {
                "id": s.id,
                "topic_id": s.data["topic_id"],
                "topic": s.data["topic"],
                "status": s.status,
                "created_at": s.data["created_at"],
                "completed_at": s.data["completed_at"],
                "turn_count": len(s.data["turns"]),
                "outcome": s.data.get("report", {}).get("outcome"),
            }
            for s in sessions
        ]
    }


@router.get("/sessions/{session_id}")
def get_session(session_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    return session_view(owned(db, session_id, user))


@router.post("/sessions/{session_id}/answers")
def submit_answer(
    session_id: str,
    body: AnswerIn,
    background_tasks: BackgroundTasks,
    user: User = Depends(participant),
    db: Session = Depends(get_db),
):
    session = owned(db, session_id, user, write=True)
    request_digest = hashlib.sha256(
        json.dumps(body.model_dump(), sort_keys=True).encode()
    ).hexdigest()
    previous = db.scalar(
        select(Turn).where(Turn.session_id == session_id, Turn.request_id == body.request_id)
    )
    if previous:
        if previous.request_digest != request_digest:
            raise HTTPException(409, "This request_id was already used for a different answer.")
        return previous.response
    if session.status != "active":
        raise HTTPException(409, "Session is already complete.")
    data = deepcopy(session.data)
    current = data["current_question"]
    if not current or body.question_id != current["id"]:
        raise HTTPException(409, "This question is stale. Refresh the current session.")
    index = current["_concept_index"]
    prior = [t for t in data["turns"] if t["concept_index"] == index]
    if not body.skip and wants_to_stop(body.transcript):
        # The student asked to end: finish with the evidence so far, without assessing this utterance.
        data["ended_early"] = True
        data["completed_concepts"] = index
        complete(db, session, data)
        save_session(db, session, data, "completed")
        db.commit()
        background_tasks.add_task(deliver_review_notifications, session.id)
        return {
            "session": session_view(session),
            "assessment": None,
            "action": "STUDENT_ENDED_SESSION",
        }
    if body.skip:
        turn = {
            "id": uid(),
            "question_id": current["id"],
            "question": current["question"],
            "concept_index": index,
            "transcript": "[skipped by student]",
            "depth": current["depth"],
            "action": "SKIPPED_NEXT_CONCEPT",
            "skipped": True,
            "assessment": {
                "state": "non_answer",
                "coverage": 0.0,
                "rubric_hits": [],
                "missing_points": [],
                "misconceptions": [],
                "reason": "The student chose to skip this question.",
                "provider": "student_skip",
            },
            "input_mode": body.input_mode,
            "hesitation": hesitation("", "text"),
            "scaffolded": False,
            "elicitation_action": current["_elicitation_action"],
            "created_at": now(),
            "target_rubric_id": None,
            "policy_version": data["policy_version"],
            "provider": "student_skip",
        }
        data["turns"].append(turn)
        next_q, _ = next_question(data, current, turn["assessment"], "SKIPPED_NEXT_CONCEPT")
        data["current_question"] = next_q
        status = "active" if next_q else "completed"
        if not next_q:
            complete(db, session, data)
        save_session(db, session, data, status)
        response = {
            "session": session_view(session),
            "assessment": None,
            "action": "SKIPPED_NEXT_CONCEPT",
        }
        db.add(
            Turn(
                id=turn["id"],
                session_id=session.id,
                question_id=current["id"],
                request_id=body.request_id,
                request_digest=request_digest,
                data=turn,
                response=response,
            )
        )
        db.commit()
        return response
    assessment = assess(
        data["snapshots"][index],
        current["question"],
        body.transcript,
        prior,
        follow_up_plans(data, current, prior) if llm_wording() else None,
    )
    draft = assessment.pop("_draft", None)
    action = policy(assessment["state"], current["depth"], data["max_depth"], prior)
    turn = {
        "id": uid(),
        "question_id": current["id"],
        "question": current["question"],
        "concept_index": index,
        "transcript": body.transcript,
        "depth": current["depth"],
        "action": action,
        "assessment": assessment,
        "input_mode": body.input_mode,
        "hesitation": hesitation(
            body.transcript,
            body.input_mode,
            body.response_latency_ms,
            body.audio_metrics.model_dump() if body.audio_metrics else None,
        ),
        "scaffolded": current["_scaffolded"],
        "elicitation_action": current["_elicitation_action"],
        "created_at": now(),
        "target_rubric_id": current.get("_target_rubric_id"),
        "policy_version": data["policy_version"],
        "provider": assessment["provider"],
    }
    data["turns"].append(turn)
    next_q, action = next_question(data, current, assessment, action)
    turn["action"] = action
    if next_q and next_q["_concept_index"] == index:
        turn["follow_up_phrasing"] = phrase(
            data, index, prior, next_q, assessment, body.transcript, action, draft
        )
    turn["selected_follow_up"] = (
        next_q["question"] if next_q and next_q["_concept_index"] == index else None
    )
    data["current_question"] = next_q
    if next_q is None:
        complete(db, session, data)
        status = "completed"
    else:
        status = "active"
    save_session(db, session, data, status)
    response = {
        "session": session_view(session),
        "assessment": public_assessment(assessment, status == "completed"),
        "action": action,
    }
    db.add(
        Turn(
            id=turn["id"],
            session_id=session.id,
            question_id=current["id"],
            request_id=body.request_id,
            request_digest=request_digest,
            data=turn,
            response=response,
        )
    )
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        existing = db.scalar(
            select(Turn).where(Turn.session_id == session_id, Turn.request_id == body.request_id)
        )
        if existing and existing.request_digest == request_digest:
            return existing.response
        raise HTTPException(
            409, "This question has already been answered; refresh the session."
        ) from None
    if status == "completed":
        background_tasks.add_task(deliver_review_notifications, session.id)
    return response


@router.post("/sessions/{session_id}/finish")
def finish_session(
    session_id: str,
    background_tasks: BackgroundTasks,
    user: User = Depends(participant),
    db: Session = Depends(get_db),
):
    session = owned(db, session_id, user, write=True)
    if session.status == "completed":
        return session.data["report"]
    data = deepcopy(session.data)
    data["ended_early"] = True
    data["completed_concepts"] = data["current_question"]["_concept_index"]
    report = complete(db, session, data)
    save_session(db, session, data, "completed")
    db.commit()
    background_tasks.add_task(deliver_review_notifications, session.id)
    return report


@router.get("/sessions/{session_id}/report")
def report(session_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    session = owned(db, session_id, user)
    if session.status != "completed":
        raise HTTPException(409, "Finish the session before viewing its report.")
    return session.data["report"]


@router.get("/sessions/{session_id}/export")
def export_session(
    session_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)
):
    session = owned(db, session_id, user)
    if session.status != "completed":
        raise HTTPException(409, "Finish the session before exporting rubric and audit evidence.")
    return JSONResponse(
        {"session_id": session.id, "session": session.data},
        headers={"Content-Disposition": f'attachment; filename="viva-{session.id}.json"'},
    )
