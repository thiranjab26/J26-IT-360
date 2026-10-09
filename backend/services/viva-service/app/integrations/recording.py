"""Analyse a whole recorded viva: the shared core of scripts/analyze_recordings.py and the
admin "Analyse a recording" page.

Audio in, fluency measures out (see app/domain/fluency.py for the definitions). Optional
inputs: the examiner's own track, which splits the student's track per question and gives
response times, and word timings (CrisperWhisper JSON, Groq or local Whisper).
"""

from app.domain import fluency
from app.domain.fluency import Word

SAMPLE_RATE = 16000
MAX_SECONDS = 2 * 3600
JOIN_GAP_S = 1.5  # the examiner's speech separated by less than this is one turn
QUESTION_MIN_S = 2.0  # shorter turns ("Take your time") do not start a new answer


def decode(content, max_seconds=MAX_SECONDS):
    from app.integrations.speech import decode_bounded

    return decode_bounded(content, max_seconds=max_seconds)


def speech_intervals(audio):
    from faster_whisper.vad import VadOptions, get_speech_timestamps

    options = VadOptions(
        threshold=0.5,
        min_speech_duration_ms=100,
        min_silence_duration_ms=int(fluency.SILENT_PAUSE_S * 1000),
        speech_pad_ms=0,
    )
    stamps = get_speech_timestamps(audio, vad_options=options, sampling_rate=SAMPLE_RATE)
    return [(x["start"] / SAMPLE_RATE, x["end"] / SAMPLE_RATE) for x in stamps]


def syllables(audio):
    """Acoustic syllable nuclei, or [] when the optional research extra is not installed."""
    try:
        from app.integrations.syllables import syllable_nuclei
    except ImportError:
        return []
    try:
        return syllable_nuclei(audio, SAMPLE_RATE)
    except ImportError:
        return []


def words_from_json(data):
    items = data["words"] if isinstance(data, dict) else data
    return [Word(float(w["start"]), float(w["end"]), str(w["word"])) for w in items]


def transcribe(content, suffix, audio, how, model_name="small.en"):
    """Word timings with fillers kept: Groq (fast, cloud) or local faster-whisper (private)."""
    from app.integrations.speech import FILLER_PROMPT

    if how == "groq":
        from app.integrations.speech import cloud_transcribe

        segments = cloud_transcribe(content, suffix)
        return [Word(w["start"], w["end"], w["word"]) for s in segments for w in s["words"]]
    from faster_whisper import WhisperModel

    model = WhisperModel(model_name, device="cpu", compute_type="int8")
    segments, _ = model.transcribe(
        audio,
        language="en",
        word_timestamps=True,
        initial_prompt=FILLER_PROMPT,
        condition_on_previous_text=False,
        vad_filter=True,
        vad_parameters={"min_silence_duration_ms": 2000, "speech_pad_ms": 400},
        temperature=0,
    )
    return [Word(w.start, w.end, w.word) for s in segments for w in (s.words or [])]


def question_turns(examiner_speech):
    """The examiner's speaking turns long enough to be a question or follow-up."""
    turns = []
    for start, end in examiner_speech:
        if turns and start - turns[-1][1] <= JOIN_GAP_S:
            turns[-1] = (turns[-1][0], end)
        else:
            turns.append((start, end))
    return [t for t in turns if t[1] - t[0] >= QUESTION_MIN_S]


def answer_windows(turns, student_speech, duration):
    """(question end, start, stop) for every question the student answered."""
    if not turns:
        return [(None, 0.0, duration)]
    windows = []
    for k, (_, question_end) in enumerate(turns):
        stop = turns[k + 1][0] if k + 1 < len(turns) else duration
        if any(s < stop and e > question_end for s, e in student_speech):
            windows.append((question_end, question_end, stop))
    return windows


def analyse(
    audio, words, nuclei, examiner_speech=None, warmup=False, check_answer=2, check_seconds=60.0
):
    """Measures for one recorded viva.

    Returns session (whole-viva measures and literature flags), answers (one row per answer),
    windows (15-second timeline), check (the counting-check minute) and the detected speech
    and question turns.
    """
    duration = len(audio) / SAMPLE_RATE
    speech = speech_intervals(audio)
    turns = question_turns(examiner_speech) if examiner_speech else []
    rows, window_rows = [], []
    for number, (question_end, start, stop) in enumerate(
        answer_windows(turns, speech, duration), 1
    ):
        c = fluency.counts(speech, nuclei, words, start, stop)
        if not c:
            continue
        latency = c["first_speech"] - question_end if question_end is not None else None
        measured = fluency.rates(c, [latency])
        rows.append(
            {
                "answer": number,
                "start_s": round(start, 2),
                "end_s": round(stop, 2),
                "counts": c,
                "latency": latency,
                **measured,
            }
        )
        for w in fluency.windows(speech, nuclei, words, c["first_speech"], stop):
            window_rows.append({"answer": number, **w})
    warm = rows[0] if warmup and len(rows) > 1 else None
    viva = rows[1:] if warm else rows
    session = fluency.rates(
        fluency.total([r["counts"] for r in viva]), [r["latency"] for r in viva]
    )
    flagged = fluency.flags(session)
    summary = {
        "answers": len(viva),
        **(session or {}),
        "literature_flags": len(flagged),
        "literature_flagged": fluency.communication_flagged(session) if session else None,
        "flagged_measures": " ".join(flagged),
    }
    if warm:
        summary.update(
            {
                f"warmup_{k}": warm.get(k)
                for k in ("speech_rate_syll_s", "mean_silent_pause_ms", "filled_pauses_per_min")
            }
        )
    check = None
    chosen = viva[min(check_answer, len(viva)) - 1] if viva else None
    if chosen:
        begin = chosen["counts"]["first_speech"]
        finish = min(begin + check_seconds, chosen["end_s"])
        check = {"begin": begin, "finish": finish, **fluency.noticed(speech, words, begin, finish)}
    for r in rows:
        r.pop("counts")
        r.pop("latency")
    return {
        "duration_s": round(duration, 2),
        "session": summary,
        "answers": rows,
        "windows": window_rows,
        "check": check,
        "speech": speech,
        "turns": turns,
    }
