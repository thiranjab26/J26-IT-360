"""Optional local transcription plus Silero VAD pause observations.

Only internal gaps between detected speech intervals count as pauses. These are
algorithmic observations, not validated psychological measures.
"""

import io
import logging
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


def pause_spans(intervals, sample_count, sample_rate=SAMPLE_RATE):
    """Internal VAD gaps of at least MIN_PAUSE_MS as (start s, end s, ms)."""
    merged = []
    for interval in sorted(intervals, key=lambda x: x["start"]):
        start, end = max(0, interval["start"]), min(sample_count, interval["end"])
        if end <= start:
            continue
        if merged and start <= merged[-1]["end"]:
            merged[-1]["end"] = max(end, merged[-1]["end"])
        else:
            merged.append({"start": start, "end": end})
    spans = []
    for previous, current in zip(merged, merged[1:], strict=False):
        duration_ms = max(0, current["start"] - previous["end"]) * 1000 / sample_rate
        if duration_ms >= MIN_PAUSE_MS:
            spans.append(
                (previous["end"] / sample_rate, current["start"] / sample_rate, duration_ms)
            )
    return spans


def pause_metrics(intervals, sample_count, sample_rate=SAMPLE_RATE):
    """Summarize VAD intervals without counting leading/trailing silence."""
    if sample_rate <= 0 or sample_count < 0:
        raise ValueError("Invalid audio duration.")
    pauses = [ms for _, _, ms in pause_spans(intervals, sample_count, sample_rate)]
    return {
        "pause_count": len(pauses),
        "total_pause_ms": round(sum(pauses), 1),
        "average_pause_ms": round(sum(pauses) / len(pauses), 1) if pauses else 0,
        "long_pause_count": sum(p >= 2000 for p in pauses),
        "audio_duration_ms": round(sample_count * 1000 / sample_rate, 1),
    }


def research_intervals(audio):
    """Speech intervals with the research tool's VAD settings: pauses count from 250 ms."""
    from faster_whisper.vad import VadOptions, get_speech_timestamps

    from app.domain.fluency import SILENT_PAUSE_S

    options = VadOptions(
        threshold=0.5,
        min_speech_duration_ms=100,
        min_silence_duration_ms=int(SILENT_PAUSE_S * 1000),
        speech_pad_ms=0,
    )
    stamps = get_speech_timestamps(audio, vad_options=options, sampling_rate=SAMPLE_RATE)
    return [(x["start"] / SAMPLE_RATE, x["end"] / SAMPLE_RATE) for x in stamps]


def answer_fluency(audio, words):
    """The research's literature-profile measures for one answer (fluency.answer_profile, the
    research tool's own code). None without word timings; a failure never blocks the transcript."""
    if not words:
        return None
    from app.domain import fluency

    try:
        timed = [fluency.Word(w["start"], w["end"], w["word"]) for w in words]
        return fluency.answer_profile(research_intervals(audio), timed)
    except Exception:  # noqa: BLE001 - supplementary evidence only
        logging.getLogger(__name__).warning("Fluency measures failed", exc_info=True)
        return None


def decode_bounded(content, max_seconds=MAX_AUDIO_SECONDS):
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
                if count > SAMPLE_RATE * max_seconds:
                    raise ProviderUnavailable(
                        "Please keep each recording under three minutes, or use typed input."
                    )
                chunks.append(samples)
        for converted in resampler.resample(None):
            samples = converted.to_ndarray().reshape(-1)
            count += len(samples)
            if count > SAMPLE_RATE * max_seconds:
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
                "timestamp_granularities[]": ["segment", "word"],
                "language": cfg.whisper_language or "en",
                "temperature": "0",
            },
        )
        response.raise_for_status()
        body = response.json()
        segments = [
            {"start": s["start"], "end": s["end"], "text": s["text"].strip(), "words": []}
            for s in body.get("segments", [])
        ]
        if segments:
            # Word timings come at the top level; they only feed the pause display.
            segments[0]["words"] = [
                {"start": w["start"], "end": w["end"], "word": w["word"]}
                for w in body.get("words") or []
            ]
        return segments
    except (httpx.HTTPError, ValueError, KeyError, TypeError) as exc:
        raise ProviderUnavailable(f"Cloud transcription failed ({type(exc).__name__}).") from exc


def pause_marks(transcript, words, spans):
    """Character positions in the transcript where each measured pause ends, for display only.

    Words are matched to the transcript in order. Whisper stretches the word before a silence
    over the gap, so the pause goes before the first word starting at or after the pause start.
    Pauses without word timings are left out.
    """
    offsets, cursor, lower = [], 0, transcript.lower()
    for w in words:
        token = w["word"].strip().lower()
        index = lower.find(token, cursor) if token else -1
        offsets.append(index)
        if index >= 0:
            cursor = index + len(token)
    timed = [(w["start"], index) for w, index in zip(words, offsets, strict=True) if index >= 0]
    marks = []
    for start, _, ms in spans:
        after = [index for begin, index in timed if begin >= start - 0.05]
        if after:
            marks.append({"char": after[0], "ms": round(ms)})
    return marks


def deepgram_ready():
    cfg = settings()
    return bool(cfg.allow_cloud_llm and cfg.deepgram_api_key)


@lru_cache(maxsize=128)
def synthesize(text):
    """Question audio as (bytes, media type, provider). Cached so replays cost nothing."""
    import httpx

    cfg = settings()
    if deepgram_ready() and cfg.deepgram_tts_daily_chars:
        from app.core.limits import reserve_voice

        try:
            reserve_voice(len(text))
            response = httpx.post(
                "https://api.deepgram.com/v1/speak",
                params={"model": cfg.deepgram_tts_model, "encoding": "mp3"},
                timeout=20,
                headers={"Authorization": f"Token {cfg.deepgram_api_key}"},
                json={"text": text},
            )
            response.raise_for_status()
            return response.content, "audio/mpeg", "deepgram:" + cfg.deepgram_tts_model
        except (httpx.HTTPError, HTTPException):
            pass  # budget used up or Deepgram failed: try Groq, then the browser voice
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
        return response.content, "audio/wav", "groq:" + cfg.tts_model
    except httpx.HTTPError as exc:
        raise ProviderUnavailable(
            f"Cloud voice failed ({type(exc).__name__}); the browser voice is used instead."
        ) from exc


_voice_locks = {}
_voice_guard = threading.Lock()


def voice(text):
    """synthesize() with one provider call per text: a warm-up and the student's request share it."""
    with _voice_guard:
        if len(_voice_locks) > 512:
            _voice_locks.clear()
        lock = _voice_locks.setdefault(text, threading.Lock())
    with lock:
        return synthesize(text)


def warm(texts):
    """Prepare upcoming question audio in the background so it plays without waiting."""
    cfg = settings()
    if not cfg.allow_cloud_llm or not (cfg.speech_api_key or cfg.deepgram_api_key):
        return

    def run():
        for text in texts:
            try:
                voice(" ".join(text.split()))
            except (ProviderUnavailable, HTTPException):
                return  # the browser voice remains the fallback

    threading.Thread(target=run, daemon=True).start()


def transcribe(content, suffix, live=None):
    # Fail fast instead of queuing unlimited expensive inference requests.
    if not _inference_lock.acquire(blocking=False):
        raise HTTPException(
            429,
            "Transcription is busy. Keep your recording and retry shortly.",
            headers={"Retry-After": "5"},
        )
    try:
        return _transcribe(content, suffix, live)
    finally:
        _inference_lock.release()


def _transcribe(content, suffix, live=None):
    """live: (transcript, provider) already streamed by Deepgram; only pauses are measured here."""
    started = time.monotonic()
    if not live and settings().speech_provider not in ("faster_whisper", "groq"):
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
        if live:
            segments = [{"start": 0, "end": len(audio) / SAMPLE_RATE, "text": live[0], "words": []}]
            provider = live[1]
        elif cfg.speech_provider == "groq":
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
            "metrics": {
                **pause_metrics(intervals, len(audio)),
                "fluency": answer_fluency(audio, [w for s in segments for w in s["words"]]),
            },
            "pause_marks": pause_marks(
                transcript,
                [w for s in segments for w in s["words"]],
                pause_spans(intervals, len(audio)),
            ),
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
                    if provider.startswith(("groq", "deepgram"))
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
