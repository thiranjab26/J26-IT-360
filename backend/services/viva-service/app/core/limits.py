"""Atomic fixed-window reservations shared by SQLite/Neon workers.

Failed provider attempts remain charged: retries must never circumvent a budget.
Token reservations use UTF-8 bytes plus maximum output, deliberately conservative.
"""

import threading
import time
from contextvars import ContextVar

from fastapi import HTTPException
from sqlalchemy import delete, select

from app.config import settings
from app.db.session import SessionLocal
from app.db.tables import UsageCounter

actor = ContextVar("usage_actor", default="internal")
# ponytail: per-process request throttling; LLM/speech budgets below stay database-shared across workers.
_windows = {}
_windows_lock = threading.Lock()


def hit(scope, window, cap):
    """In-memory fixed-window request limit: no database round trip per API request."""
    stamp = int(time.time())
    boundary = stamp // window * window
    with _windows_lock:
        if len(_windows) > 20000:
            for key in [k for k in _windows if k[1] + window < stamp]:
                del _windows[key]
        used = _windows.get((scope, boundary), 0) + 1
        if used > cap:
            raise HTTPException(
                429,
                f"{scope.split(':')[0]} limit reached. Try again after the reset.",
                headers={"Retry-After": str(boundary + window - stamp)},
            )
        _windows[(scope, boundary)] = used


def reserve(entries):
    """Entries: (scope, window seconds, cap, amount); all succeed or none do."""
    stamp = int(time.time())
    with SessionLocal.begin() as db:
        if db.bind.dialect.name == "postgresql":
            from sqlalchemy.dialects.postgresql import insert
        else:
            from sqlalchemy.dialects.sqlite import insert
        for scope, window, cap, amount in sorted(entries):
            boundary = stamp // window * window
            key = f"{scope}:{boundary}"
            retry = boundary + window - stamp
            if amount > cap:
                raise HTTPException(
                    429,
                    f"{scope.split(':')[0]} budget exhausted.",
                    headers={"Retry-After": str(retry)},
                )
            stmt = insert(UsageCounter).values(key=key, used=amount, expires=boundary + window)
            stmt = stmt.on_conflict_do_update(
                index_elements=["key"],
                set_={"used": UsageCounter.used + amount},
                where=UsageCounter.used + amount <= cap,
            ).returning(UsageCounter.used)
            if db.execute(stmt).scalar_one_or_none() is None:
                raise HTTPException(
                    429,
                    f"{scope.split(':')[0]} limit reached. Try again after the reset.",
                    headers={"Retry-After": str(retry)},
                )
        db.execute(delete(UsageCounter).where(UsageCounter.expires < stamp - 86400))


def reserve_llm(tokens):
    cfg = settings()
    reserve(
        [
            ("llm-minute", 60, cfg.llm_requests_per_minute, 1),
            ("llm-day", 86400, cfg.llm_daily_calls, 1),
            (f"llm-user:{actor.get()}", 86400, cfg.llm_user_daily_calls, 1),
            ("llm-tokens", 86400, cfg.llm_daily_token_budget, tokens),
        ]
    )


def reserve_speech(user_id):
    cfg = settings()
    reserve(
        [
            ("speech-day", 86400, cfg.speech_daily_calls, 1),
            (f"speech-user:{user_id}", 86400, cfg.speech_user_daily_calls, 1),
        ]
    )


def usage():
    stamp = int(time.time())
    with SessionLocal() as db:
        rows = db.scalars(select(UsageCounter).where(UsageCounter.expires > stamp))
        return [
            {"scope": r.key.rsplit(":", 1)[0], "used": r.used, "resets_at": r.expires}
            for r in rows
            if r.key.split(":")[0] in ("llm-minute", "llm-day", "llm-tokens", "speech-day")
        ]
