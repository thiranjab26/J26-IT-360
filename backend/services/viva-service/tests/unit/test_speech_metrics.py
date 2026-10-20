"""Pause measurement excludes silence outside an answer and respects modality."""

import io
import wave

import pytest

from app.integrations.speech import decode_bounded, pause_metrics


def test_only_internal_silence_counts():
    result = pause_metrics(
        [
            {"start": 16000, "end": 32000},
            {"start": 48000, "end": 64000},
        ],
        80000,
    )
    assert result == {
        "pause_count": 1,
        "total_pause_ms": 1000.0,
        "average_pause_ms": 1000.0,
        "long_pause_count": 0,
        "audio_duration_ms": 5000.0,
    }


def test_short_gaps_are_not_counted_as_long_pauses():
    assert (
        pause_metrics([{"start": 0, "end": 16000}, {"start": 19200, "end": 32000}], 32000)[
            "pause_count"
        ]
        == 0
    )


def test_real_decoder_and_silero_accept_silence_without_inventing_speech():
    pytest.importorskip("av")
    pytest.importorskip("faster_whisper")
    import numpy as np
    from faster_whisper.vad import VadOptions, get_speech_timestamps

    buf = io.BytesIO()
    with wave.open(buf, "wb") as recording:
        recording.setnchannels(1)
        recording.setsampwidth(2)
        recording.setframerate(16000)
        recording.writeframes(np.zeros(32000, dtype=np.int16).tobytes())
    audio = decode_bounded(buf.getvalue())
    assert len(audio) == 32000
    assert (
        get_speech_timestamps(audio, VadOptions(min_silence_duration_ms=400, speech_pad_ms=0)) == []
    )


def test_pause_marks_sit_before_the_word_after_each_pause():
    from app.integrations.speech import pause_marks

    # Real Whisper timing: the word before a silence is stretched over it ("a" ends at 1.9).
    words = [
        {"start": 0.0, "end": 0.3, "word": " Um"},
        {"start": 0.4, "end": 1.9, "word": " a"},
        {"start": 1.9, "end": 2.4, "word": " stack"},
    ]
    marks = pause_marks("Um, a stack.", words, [(0.7, 1.95, 1250.0)])
    assert marks == [{"char": 6, "ms": 1250}]
    assert pause_marks("Um, a stack.", [], [(0.7, 1.95, 1250.0)]) == []


def test_voice_shares_one_provider_call_per_question(monkeypatch):
    import threading
    import time

    from app.integrations import speech

    calls = []

    def slow(text):
        calls.append(text)
        time.sleep(0.2)
        return b"audio", "audio/wav", "test"

    monkeypatch.setattr(speech, "synthesize", __import__("functools").lru_cache(slow))
    threads = [threading.Thread(target=speech.voice, args=("What is a stack?",)) for _ in range(3)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert calls == ["What is a stack?"]


def test_answer_fluency_uses_research_pauses_and_never_blocks_a_transcript(monkeypatch):
    from app.integrations import speech

    monkeypatch.setattr(speech, "research_intervals", lambda audio: [(0.0, 6.0), (6.6, 12.0)])
    words = [{"start": i * 0.5, "end": i * 0.5 + 0.3, "word": " stack"} for i in range(24)]
    result = speech.answer_fluency(None, words)
    assert result["silent_pauses"] == 1 and result["speaking_time_s"] == 12.0
    assert speech.answer_fluency(None, []) is None

    def broken(audio):
        raise RuntimeError("VAD failed")

    monkeypatch.setattr(speech, "research_intervals", broken)
    assert speech.answer_fluency(None, words) is None


def test_live_fluency_uses_the_research_tools_vad_settings(monkeypatch):
    """The live viva and the recording analysis must measure pauses the same way."""
    vad = pytest.importorskip("faster_whisper.vad")
    recording = pytest.importorskip("app.integrations.recording")
    from app.integrations import speech

    seen = []
    monkeypatch.setattr(
        vad, "get_speech_timestamps", lambda a, vad_options, **k: seen.append(vad_options) or []
    )
    speech.research_intervals([])
    recording.speech_intervals([])
    assert seen[0] == seen[1] and seen[0].min_silence_duration_ms == 250


def test_voice_says_code_and_maths_as_words():
    from app.integrations.speech import speakable

    assert speakable(
        "What is 2 + 3 * 4, and why? Then explain what the expression x > 0 and x < 10 checks."
    ) == (
        "What is 2 plus 3 times 4, and why? Then explain what the expression x is greater than 0 "
        "and x is less than 10 checks."
    )
    assert speakable("O(n log n) beats O(n^2)") == "O of n log n beats O of n squared"
    assert (
        speakable("scores[2] = 90 and b = a.copy()")
        == "scores at index 2 equals 90 and b equals a dot copy"
    )
    assert speakable("for i in range(len(scores))") == "for i in range of len of scores"
    assert speakable("factorial(n - 1), 7.5 and first-in, first-out") == (
        "factorial of n minus 1, 7.5 and first-in, first-out"
    )
    assert speakable("Name three kinds of operators, e.g., +, -, *?") == (
        "Name three kinds of operators, for example, plus, minus, times?"
    )
    assert speakable("Is it comparison/relational, i.e. a **boolean** test?") == (
        "Is it comparison or relational, that is, a boolean test?"
    )


def test_course_words_prime_the_transcriber():
    from app.integrations.speech import FILLER_PROMPT, vocabulary_prompt

    assert vocabulary_prompt() == FILLER_PROMPT
    assert vocabulary_prompt(["float", "whole number", "7.5", "integer", "name"]).endswith(
        "programming, uh, float, um, whole, um, number, um, integer."
    )


def test_audio_for_the_cloud_transcriber_is_a_valid_wav():
    import io
    import wave

    import numpy as np

    from app.integrations.speech import SAMPLE_RATE, wav_bytes

    with wave.open(io.BytesIO(wav_bytes(np.zeros(SAMPLE_RATE, dtype=np.float32)))) as w:
        assert (w.getnchannels(), w.getframerate(), w.getnframes()) == (1, SAMPLE_RATE, SAMPLE_RATE)
