"""C4 speech routes, mounted under /api/v1/viva."""

import asyncio
import contextlib
import json
import time
from urllib.parse import urlencode

from fastapi import (
    APIRouter,
    Depends,
    File,
    Form,
    HTTPException,
    Response,
    UploadFile,
    WebSocket,
    WebSocketDisconnect,
)
from sqlalchemy import select
from starlette.concurrency import run_in_threadpool

from app.config import settings
from app.core import limits
from app.core.auth import current_user, lookup, participant
from app.db.session import SessionLocal
from app.db.tables import Bank, User
from app.integrations import speech
from app.integrations.llm import ProviderUnavailable
from app.models.schemas import SpeakIn

router = APIRouter()
MAX_LIVE_SECONDS = 180
_live_streams = 0


@router.post("/speech/synthesize")
async def synthesize_speech(body: SpeakIn, user: User = Depends(current_user)):
    try:
        audio, media, provider = await run_in_threadpool(speech.voice, " ".join(body.text.split()))
    except ProviderUnavailable as exc:
        raise HTTPException(503, str(exc)) from exc
    return Response(
        audio,
        media_type=media,
        headers={"Cache-Control": "private, max-age=86400", "X-Voice-Provider": provider},
    )


@router.post("/speech/transcribe")
async def transcribe_audio(
    audio: UploadFile = File(...),
    live_transcript: str | None = Form(default=None, max_length=10000),
    user: User = Depends(participant),
):
    types = {
        "audio/webm": ".webm",
        "video/webm": ".webm",
        "audio/wav": ".wav",
        "audio/x-wav": ".wav",
        "audio/mpeg": ".mp3",
        "audio/mp4": ".mp4",
        "audio/ogg": ".ogg",
        "audio/flac": ".flac",
    }
    mime = (audio.content_type or "").split(";")[0]
    if mime not in types:
        await audio.close()
        raise HTTPException(415, "Use an audio WebM, WAV, MP3, MP4, OGG, or FLAC recording.")
    content = await audio.read(settings().max_audio_bytes + 1)
    await audio.close()
    if len(content) > settings().max_audio_bytes:
        raise HTTPException(413, "Audio exceeds the configured size limit (20 MB by default).")
    if not content:
        raise HTTPException(422, "Audio recording is empty.")
    live = None
    if live_transcript and live_transcript.strip():
        # Deepgram already transcribed it live; only the local pause measurement runs here.
        live = (" ".join(live_transcript.split()), f"deepgram:{settings().deepgram_stt_model}:live")
    else:
        await run_in_threadpool(limits.reserve_speech, user.id)
    return await run_in_threadpool(speech.transcribe, content, types[mime], live)


def topic_terms(db, topic_id):
    """Course vocabulary for Deepgram keyterm prompting, built from the approved bank.

    Topic-wide and including misconception terms, so it helps recognise technical words
    without favouring the correct answer to the current question.
    """
    terms = []
    for bank in db.scalars(
        select(Bank).where(Bank.topic_id == topic_id, Bank.status == "approved")
    ):
        data = bank.data
        terms += [data["concept"]]
        terms += [k for p in data["rubric_points"] for k in p["keywords"]]
        terms += [k for m in data["misconceptions"] for k in m["keywords"]]
    clean = (" ".join(t.split()) for t in terms)
    return list(dict.fromkeys(t for t in clean if 4 <= len(t) <= 40))[:50]


@router.websocket("/speech/live")
async def live_transcription(ws: WebSocket):
    """Relay microphone audio to Deepgram so the key, term list and budget stay server-side.

    Client: send {"token", "topic_id"} first, then binary audio chunks, then the text "stop".
    Server: {"type": "ready" | "transcript" | "error" | "closed", ...}.
    """
    global _live_streams
    import websockets

    cfg = settings()
    await ws.accept()
    counted = False
    try:
        hello = await asyncio.wait_for(ws.receive_json(), 10)
        with SessionLocal() as db:
            user = lookup(db, str(hello.get("token", "")))
            terms = topic_terms(db, str(hello.get("topic_id", ""))) if user else []
        if not user or user.role != "participant":
            raise HTTPException(401, "Sign in as a participant to use live transcription.")
        if not speech.deepgram_ready() or not cfg.deepgram_daily_seconds:
            raise HTTPException(503, "Live transcription is not configured.")
        if _live_streams >= cfg.deepgram_max_streams:
            raise HTTPException(429, "Live transcription is busy.")
        _live_streams, counted = _live_streams + 1, True
        await run_in_threadpool(limits.reserve_live, user.id)
        query = urlencode(
            [
                ("model", cfg.deepgram_stt_model),
                ("language", "en"),
                ("filler_words", "true"),  # keep "um" and "uh": they are hesitation evidence
                ("punctuate", "true"),
                ("interim_results", "true"),
            ]
            + [("keyterm", t) for t in terms]
        )
        async with websockets.connect(
            "wss://api.deepgram.com/v1/listen?" + query,
            additional_headers={"Authorization": f"Token {cfg.deepgram_api_key}"},
            open_timeout=10,
        ) as deepgram:
            await ws.send_json({"type": "ready", "provider": f"deepgram:{cfg.deepgram_stt_model}"})
            started, paid = time.monotonic(), limits.LIVE_CHUNK_SECONDS

            async def upstream():
                nonlocal paid
                while True:
                    message = await ws.receive()
                    if message["type"] == "websocket.disconnect":
                        return
                    if message.get("bytes"):
                        elapsed = time.monotonic() - started
                        if elapsed > MAX_LIVE_SECONDS:
                            raise HTTPException(429, "The live recording limit is 3 minutes.")
                        if elapsed > paid:
                            await run_in_threadpool(limits.reserve_live, user.id)
                            paid += limits.LIVE_CHUNK_SECONDS
                        await deepgram.send(message["bytes"])
                    elif message.get("text") == "stop":
                        await deepgram.send(json.dumps({"type": "CloseStream"}))
                        return

            async def downstream():
                async for raw in deepgram:
                    data = json.loads(raw)
                    if data.get("type") == "Results":
                        await ws.send_json(
                            {
                                "type": "transcript",
                                "text": data["channel"]["alternatives"][0]["transcript"],
                                "final": bool(data.get("is_final")),
                            }
                        )

            up, down = asyncio.create_task(upstream()), asyncio.create_task(downstream())
            done, _ = await asyncio.wait({up, down}, return_when=asyncio.FIRST_COMPLETED)
            if up in done:
                up.result()
                # After CloseStream Deepgram sends the last finals, then closes.
                await asyncio.wait_for(down, 10)
            else:
                up.cancel()
                down.result()
        await ws.send_json({"type": "closed"})
    except WebSocketDisconnect:
        return
    except HTTPException as exc:
        await safe_send(ws, {"type": "error", "message": str(exc.detail)})
    except (TimeoutError, OSError, ValueError, KeyError, websockets.WebSocketException) as exc:
        await safe_send(
            ws, {"type": "error", "message": f"Live transcription failed ({type(exc).__name__})."}
        )
    finally:
        if counted:
            _live_streams -= 1
        with contextlib.suppress(RuntimeError):
            await ws.close()


async def safe_send(ws, message):
    with contextlib.suppress(RuntimeError, WebSocketDisconnect):
        await ws.send_json(message)
