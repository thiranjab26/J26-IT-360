"""C4 speech routes, mounted under /api/v1/viva."""

from fastapi import APIRouter, Depends, File, HTTPException, Response, UploadFile

from app.config import settings
from app.core import limits
from app.core.auth import current_user, participant
from app.db.tables import User
from app.integrations import speech
from app.integrations.llm import ProviderUnavailable
from app.models.schemas import SpeakIn

router = APIRouter()


@router.post("/speech/synthesize")
async def synthesize_speech(body: SpeakIn, user: User = Depends(current_user)):
    from starlette.concurrency import run_in_threadpool

    try:
        audio = await run_in_threadpool(speech.synthesize, " ".join(body.text.split()))
    except ProviderUnavailable as exc:
        raise HTTPException(503, str(exc)) from exc
    return Response(
        audio, media_type="audio/wav", headers={"Cache-Control": "private, max-age=86400"}
    )


@router.post("/speech/transcribe")
async def transcribe_audio(audio: UploadFile = File(...), user: User = Depends(participant)):
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
    from starlette.concurrency import run_in_threadpool

    await run_in_threadpool(limits.reserve_speech, user.id)
    return await run_in_threadpool(speech.transcribe, content, types[mime])
