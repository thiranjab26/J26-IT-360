"""Optional local transcription plus Silero VAD pause observations.

Only internal gaps between detected speech intervals count as pauses. These are
algorithmic observations, not validated psychological measures.
"""

import io
import threading
import time
from functools import lru_cache

from fastapi import HTTPException

from app.config import settings
from app.integrations.llm import ProviderUnavailable

SAMPLE_RATE = 16000
MAX_AUDIO_SECONDS = 180
MIN_PAUSE_MS = 400
# Whisper drops disfluencies unless primed with disfluent text; this keeps "um", "uh" and restarts in the transcript.
FILLER_PROMPT = (
    "Umm, uh, so, like, hmm... I mean, uh, I think, um, maybe. Erm, well, you know, uhh."
)
_inference_lock = threading.Lock()
_model_lock = threading.Lock()


def pause_metrics(intervals, sample_count, sample_rate=SAMPLE_RATE):
    """Summarize VAD intervals without counting leading/trailing silence."""
    if sample_rate <= 0 or sample_count < 0:
        raise ValueError("Invalid audio duration.")
    merged = []
    for interval in sorted(intervals, key=lambda x: x["start"]):
        start, end = max(0, interval["start"]), min(sample_count, interval["end"])
        if end <= start:
            continue
        if merged and start <= merged[-1]["end"]:
            merged[-1]["end"] = max(end, merged[-1]["end"])
        else:
            merged.append({"start": start, "end": end})
    pauses = []
    for previous, current in zip(merged, merged[1:], strict=False):
        duration_ms = max(0, current["start"] - previous["end"]) * 1000 / sample_rate
        if duration_ms >= MIN_PAUSE_MS:
            pauses.append(duration_ms)
    return {
        "pause_count": len(pauses),
        "total_pause_ms": round(sum(pauses), 1),
        "average_pause_ms": round(sum(pauses) / len(pauses), 1) if pauses else 0,
        "long_pause_count": sum(p >= 2000 for p in pauses),
        "audio_duration_ms": round(sample_count * 1000 / sample_rate, 1),
    }


def decode_bounded(content):
    """Decode in bounded chunks so compressed files cannot allocate hours of PCM."""
    import av
    import numpy as np

    chunks, count = [], 0
    with av.open(io.BytesIO(content)) as container:
        if not container.streams.audio:
            raise ProviderUnavailable("The recording contains no audio stream.")
        resampler = av.AudioResampler(format="fltp", layout="mono", rate=SAMPLE_RATE)
        for frame in container.decode(audio=0):
            for converted in resampler.resample(frame):
                samples = converted.to_ndarray().reshape(-1)
                count += len(samples)
                if count > SAMPLE_RATE * MAX_AUDIO_SECONDS:
                    raise ProviderUnavailable(
                        "Please keep each recording under three minutes, or use typed input."
                    )
                chunks.append(samples)
        for converted in resampler.resample(None):
            samples = converted.to_ndarray().reshape(-1)
            count += len(samples)
            if count > SAMPLE_RATE * MAX_AUDIO_SECONDS:
                raise ProviderUnavailable(
                    "Please keep each recording under three minutes, or use typed input."
                )
            chunks.append(samples)
    return np.concatenate(chunks).astype(np.float32) if chunks else np.empty(0, dtype=np.float32)


@lru_cache(maxsize=1)
def model():
    cfg = settings()
    if cfg.speech_provider not in ("faster_whisper", "groq"):
        raise ProviderUnavailable(
            "Local transcription is disabled. Set SPEECH_PROVIDER=faster_whisper and install requirements-speech.txt, or use typed input."
        )
    try:
        from faster_whisper import WhisperModel
    except ImportError as exc:
        raise ProviderUnavailable(
            "faster-whisper is not installed. Install requirements-speech.txt or use typed input."
        ) from exc
    try:
        return WhisperModel(
            cfg.whisper_model,
            device=cfg.whisper_device,
            compute_type=cfg.whisper_compute_type,
            cpu_threads=cfg.whisper_cpu_threads,
            num_workers=1,
        )
    except Exception as exc:
        raise ProviderUnavailable(
            "Whisper model could not be loaded. Download the configured model or set WHISPER_MODEL to a local model directory."
        ) from exc


def local_available():
    try:
        import faster_whisper  # noqa: F401

        return True
    except ImportError:
        return False


def cloud_transcribe(content, suffix):
    """Groq-hosted Whisper (OpenAI-compatible). Returns segments; raises ProviderUnavailable for local fallback."""
    import httpx

    cfg = settings()
    if not cfg.allow_cloud_llm or not cfg.speech_api_key:
        raise ProviderUnavailable(
            "Cloud transcription needs ALLOW_CLOUD_LLM=true and SPEECH_API_KEY."
        )
    try:
        response = httpx.post(
            cfg.speech_base_url.rstrip("/") + "/audio/transcriptions",
            timeout=30,
            headers={"Authorization": f"Bearer {cfg.speech_api_key}"},
            files={"file": ("answer" + suffix, content)},
            data={
                "model": cfg.speech_model,
                "prompt": FILLER_PROMPT,
                "response_format": "verbose_json",
                "language": cfg.whisper_language or "en",
                "temperature": "0",
            },
        )
        response.raise_for_status()
        return [
            {"start": s["start"], "end": s["end"], "text": s["text"].strip(), "words": []}
            for s in response.json().get("segments", [])
        ]
    except (httpx.HTTPError, ValueError, KeyError, TypeError) as exc:
        raise ProviderUnavailable(f"Cloud transcription failed ({type(exc).__name__}).") from exc


@lru_cache(maxsize=128)
def synthesize(text):
    """Human-sounding question audio (WAV). Cached so replays cost no provider call."""
    import httpx

    cfg = settings()
    if not cfg.allow_cloud_llm or not cfg.speech_api_key:
        raise ProviderUnavailable(
            "Cloud voice is not configured; the browser voice is used instead."
        )
    try:
        response = httpx.post(
            cfg.speech_base_url.rstrip("/") + "/audio/speech",
            timeout=30,
            headers={"Authorization": f"Bearer {cfg.speech_api_key}"},
            json={
                "model": cfg.tts_model,
                "voice": cfg.tts_voice,
                "input": text,
                "response_format": "wav",
            },
        )
        response.raise_for_status()
        return response.content
    except httpx.HTTPError as exc:
        raise ProviderUnavailable(
            f"Cloud voice failed ({type(exc).__name__}); the browser voice is used instead."
        ) from exc


def transcribe(content, suffix):
    # Fail fast instead of queuing unlimited expensive inference requests.
    if not _inference_lock.acquire(blocking=False):
        raise HTTPException(
            429,
            "Transcription is busy. Keep your recording and retry shortly.",
            headers={"Retry-After": "5"},
        )
    try:
        return _transcribe(content, suffix)
    finally:
        _inference_lock.release()


def _transcribe(content, suffix):
    started = time.monotonic()
    if settings().speech_provider not in ("faster_whisper", "groq"):
        raise ProviderUnavailable(
            "Transcription is disabled. Set SPEECH_PROVIDER=groq or faster_whisper, or use typed input."
        )
    try:
        from faster_whisper.vad import VadOptions, get_speech_timestamps

        audio = decode_bounded(content)
        if not len(audio):
            raise ProviderUnavailable(
                "The recording is empty. Record an answer or use typed input."
            )
        options = VadOptions(
            threshold=0.5,
            min_speech_duration_ms=100,
            min_silence_duration_ms=MIN_PAUSE_MS,
            speech_pad_ms=0,
        )
        intervals = get_speech_timestamps(audio, vad_options=options, sampling_rate=SAMPLE_RATE)
        # Quiet fillers can fall below the VAD threshold; still recognise the whole clip instead of rejecting it.
        cfg = settings()
        provider, segments = None, None
        if cfg.speech_provider == "groq":
            try:
                segments, provider = cloud_transcribe(content, suffix), "groq:" + cfg.speech_model
            except ProviderUnavailable:
                if not local_available():
                    raise
        if segments is None:
            with _model_lock:
                recognizer = model()
            # Trim only external silence using the existing VAD pass. Decode continuous speech
            # across internal gaps so short fillers and context are not cut into tiny clips.
            clip = (
                [
                    max(0, intervals[0]["start"] / SAMPLE_RATE - 0.2),
                    min(len(audio) / SAMPLE_RATE, intervals[-1]["end"] / SAMPLE_RATE + 0.2),
                ]
                if intervals
                else [0, len(audio) / SAMPLE_RATE]
            )
            iterator, _ = recognizer.transcribe(
                audio,
                vad_filter=False,
                word_timestamps=True,
                clip_timestamps=clip,
                language=cfg.whisper_language or None,
                beam_size=cfg.whisper_beam_size,
                initial_prompt=FILLER_PROMPT,
                temperature=0,
                condition_on_previous_text=False,
                hallucination_silence_threshold=2.0,
            )
            segments = [
                {
                    "start": s.start,
                    "end": s.end,
                    "text": s.text.strip(),
                    "words": [
                        {
                            "start": w.start,
                            "end": w.end,
                            "word": w.word,
                            "probability": w.probability,
                        }
                        for w in (s.words or [])
                    ],
                }
                for s in iterator
            ]
            provider = "faster_whisper_local"
        transcript = " ".join(s["text"] for s in segments).strip()
        if not transcript:
            raise ProviderUnavailable(
                "Speech was detected but no words could be recognized. Retry or type your answer."
            )
        from app.domain.disfluency import lexical_metrics

        return {
            "transcript": transcript,
            "segments": segments,
            "lexical_metrics": lexical_metrics(transcript),
            "processing_ms": round((time.monotonic() - started) * 1000),
            "metrics": pause_metrics(intervals, len(audio)),
            "speech_intervals": [
                {
                    "start": round(x["start"] / SAMPLE_RATE, 3),
                    "end": round(x["end"] / SAMPLE_RATE, 3),
                }
                for x in intervals
            ],
            "provider": provider,
            "vad": {
                "provider": "silero",
                "threshold": 0.5,
                "min_pause_ms": MIN_PAUSE_MS,
                "speech_pad_ms": 0,
                "sample_rate": SAMPLE_RATE,
            },
            "notes": [
                "Pause estimates count internal Silero VAD speech gaps of at least 400 ms, excluding leading/trailing silence.",
                "VAD thresholds need calibration for recording conditions and accents before research evaluation.",
                "Transcription may omit fillers; transcript counts are incomplete proxies.",
                "Audio is processed in memory and is not retained by this endpoint."
                + (
                    " It is sent to the configured cloud transcription service."
                    if provider.startswith("groq")
                    else ""
                ),
            ],
        }
    except ImportError as exc:
        raise ProviderUnavailable(
            "Local speech dependencies are missing. Install requirements-speech.txt or use typed input."
        ) from exc
    except ProviderUnavailable:
        raise
    except Exception as exc:
        raise ProviderUnavailable(
            "Audio could not be decoded/transcribed. Try a shorter WebM/WAV/MP4 recording or use typed input."
        ) from exc
