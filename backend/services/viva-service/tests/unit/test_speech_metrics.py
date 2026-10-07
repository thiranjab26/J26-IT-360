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
