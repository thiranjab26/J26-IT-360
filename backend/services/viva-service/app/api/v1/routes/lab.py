"""C4 speech lab: analyse an uploaded viva recording, mounted under /api/v1/viva.

Admin only. Runs the same analysis as scripts/analyze_recordings.py on one recording and
returns the measures with the literature thresholds, so the research and the system use
one implementation. Audio is processed in memory and not stored.
"""

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from starlette.concurrency import run_in_threadpool

from app.config import settings
from app.core import limits
from app.core.auth import admin
from app.db.tables import User
from app.domain.fluency import LITERATURE_PROFILE, SILENT_PAUSE_S, is_filler
from app.integrations import recording
from app.integrations.llm import ProviderUnavailable

router = APIRouter()

TYPES = {
    "audio/webm": ".webm",
    "video/webm": ".webm",
    "audio/wav": ".wav",
    "audio/x-wav": ".wav",
    "audio/wave": ".wav",
    "audio/mpeg": ".mp3",
    "audio/mp4": ".m4a",
    "audio/x-m4a": ".m4a",
    "audio/m4a": ".m4a",
    "video/mp4": ".mp4",
    "audio/ogg": ".ogg",
    "audio/flac": ".flac",
}
MAX_SECONDS = 30 * 60
# Measures that need a syllable count; without a transcript or Praat they cannot be computed.
SYLLABLE_MEASURES = ("speech_rate_syll_s", "articulation_rate_syll_s", "mean_length_of_run_syll")


async def read_audio(upload):
    mime = (upload.content_type or "").split(";")[0]
    suffix = TYPES.get(mime)
    if not suffix:
        name = (upload.filename or "").lower()
        suffix = next((s for s in set(TYPES.values()) if name.endswith(s)), None)
    if not suffix:
        await upload.close()
        raise HTTPException(415, "Use an audio file: M4A, MP3, WAV, WebM, MP4, OGG or FLAC.")
    content = await upload.read(settings().max_audio_bytes + 1)
    await upload.close()
    if len(content) > settings().max_audio_bytes:
        raise HTTPException(413, "The recording exceeds the upload size limit (20 MB by default).")
    if not content:
        raise HTTPException(422, "The recording is empty.")
    return content, suffix


def blank_syllable_measures(row):
    for key in SYLLABLE_MEASURES:
        if key in row:
            row[key] = None
    return row


@router.post("/lab/analyse")
async def analyse_recording(
    audio: UploadFile = File(...),
    examiner: UploadFile | None = File(default=None),
    transcriber: str = Form(default="auto"),
    user: User = Depends(admin),
):
    if transcriber not in ("auto", "groq", "none"):
        raise HTTPException(422, "transcriber must be auto, groq or none.")
    content, suffix = await read_audio(audio)
    examiner_audio = await read_audio(examiner) if examiner is not None else None
    cfg = settings()
    cloud = bool(cfg.allow_cloud_llm and cfg.speech_api_key)
    if transcriber == "groq" and not cloud:
        raise HTTPException(503, "Groq transcription is not configured on this server.")
    use_groq = cloud and transcriber in ("auto", "groq")
    if use_groq:
        await run_in_threadpool(limits.reserve_speech, user.id)

    def work():
        notes = []
        try:
            pcm = recording.decode(content, max_seconds=MAX_SECONDS)
        except ProviderUnavailable as exc:
            raise HTTPException(422, str(exc)) from exc
        except ImportError as exc:
            raise HTTPException(
                503,
                "Audio analysis needs the speech extra: uv sync --extra speech --extra research",
            ) from exc
        except Exception as exc:
            raise HTTPException(
                422, "The recording could not be decoded. Try an M4A, MP3 or WAV file."
            ) from exc
        if not len(pcm):
            raise HTTPException(422, "The recording has no audio.")
        nuclei = recording.syllables(pcm)
        words, source = [], "none"
        if use_groq:
            try:
                words = recording.transcribe(content, suffix, pcm, "groq")
                source = "groq:" + cfg.speech_model
            except ProviderUnavailable as exc:
                notes.append(f"Transcription failed ({exc}); measures come from the sound only.")
        examiner_speech = None
        if examiner_audio:
            try:
                examiner_speech = recording.speech_intervals(
                    recording.decode(examiner_audio[0], max_seconds=MAX_SECONDS)
                )
            except Exception:
                notes.append("The examiner recording could not be read; analysed as one answer.")
        return recording.analyse(pcm, words, nuclei, examiner_speech), words, nuclei, source, notes

    result, words, nuclei, source, notes = await run_in_threadpool(work)
    if not words and not nuclei:
        notes.append(
            "No transcript and no syllable detector (install the research extra), so speed "
            "and length-of-run measures are not available."
        )
        blank_syllable_measures(result["session"])
        for row in result["answers"] + result["windows"]:
            blank_syllable_measures(row)
    elif not words:
        notes.append(
            "No transcript: syllables were counted from the sound, which misses about 20%; "
            "fillers and pause positions are not available."
        )
    speech = result["speech"]
    pauses = [
        {"start": round(a_end, 2), "end": round(b_start, 2), "ms": round((b_start - a_end) * 1000)}
        for (_, a_end), (b_start, _) in zip(speech, speech[1:], strict=False)
        if b_start - a_end >= SILENT_PAUSE_S
    ]
    return {
        "file": audio.filename,
        "examiner_file": examiner.filename if examiner is not None else None,
        "transcript_source": source,
        "syllable_source": "transcript" if words else ("acoustic" if nuclei else "none"),
        "duration_s": result["duration_s"],
        "session": result["session"],
        "answers": result["answers"],
        "windows": result["windows"],
        "profile": {
            "name": LITERATURE_PROFILE["name"],
            "min_flags": LITERATURE_PROFILE["min_flags"],
            "rules": [
                {"measure": name, "direction": direction, "threshold": cut}
                for name, (direction, cut) in LITERATURE_PROFILE["rules"].items()
            ],
        },
        "words": [
            {
                "start": round(w.start, 2),
                "end": round(w.end, 2),
                "word": w.text,
                "filler": is_filler(w.text),
            }
            for w in words
        ],
        "pauses": pauses,
        "speech_span": [round(speech[0][0], 2), round(speech[-1][1], 2)] if speech else None,
        "question_turns": [[round(s, 2), round(e, 2)] for s, e in result["turns"]],
        "notes": notes,
    }
