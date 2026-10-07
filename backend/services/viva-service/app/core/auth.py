import hashlib
import secrets
from datetime import UTC, datetime, timedelta

from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.config import settings
from app.db.session import get_db
from app.db.tables import Token, User

bearer = HTTPBearer(auto_error=False)
# ponytail: per-process token cache (no logout/revocation exists); share via Redis if several workers need revocation.
_sessions = {}


def digest(value):
    return hashlib.sha256(value.encode()).hexdigest()


def user_view(user):
    return {"id": user.id, "participant_code": user.participant_code, "role": user.role}


def issue_token(db, user):
    token = secrets.token_urlsafe(36)
    db.flush()
    db.add(
        Token(
            digest=digest(token),
            user_id=user.id,
            expires_at=(datetime.now(UTC) + timedelta(hours=settings().token_hours)).isoformat(),
        )
    )
    db.commit()
    return {"token": token, "user": user_view(user), "capabilities": capabilities(user.role)}


def capabilities(role):
    return {
        "take_viva": role == "participant",
        "manage_bank": role == "admin",
        "rate_cases": role in ("admin", "evaluator"),
        "view_research_metrics": role == "admin",
    }


def lookup(db, token):
    """User for a bearer token, or None. Cached so most requests skip two remote database round trips."""
    key, now = digest(token), datetime.now(UTC)
    hit = _sessions.get(key)
    if hit and hit[0] > now:
        return hit[1]
    record = db.get(Token, key)
    if not record or datetime.fromisoformat(record.expires_at) <= now:
        return None
    user = db.get(User, record.user_id)
    if user:
        if len(_sessions) > 5000:
            _sessions.clear()
        db.expunge(user)
        _sessions[key] = (datetime.fromisoformat(record.expires_at), user)
    return user


def current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer),
    db: Session = Depends(get_db),
):
    if not credentials or credentials.scheme.lower() != "bearer":
        raise HTTPException(401, "A valid bearer token is required.")
    user = lookup(db, credentials.credentials)
    if not user:
        raise HTTPException(401, "Token is invalid or expired. Sign in again.")
    return user


def role_required(*roles):
    def dependency(user: User = Depends(current_user)):
        if user.role not in roles:
            raise HTTPException(403, "This action is not permitted for your role.")
        return user

    return dependency


participant = role_required("participant")
admin = role_required("admin")
researcher = role_required("admin", "evaluator")
