"""Fluency measures for the communication-gap study (PP1)."""

import numpy as np
import pytest

from app.domain import fluency
from app.domain.fluency import Word, count_syllables


def test_pauses_exclude_latency_and_trailing_silence():
    speech = [(2.0, 4.0), (4.1, 6.0), (7.0, 9.0)]  # 0.1 s gap is not a pause; 1.0 s gap is
    c = fluency.counts(speech, [], [], 0.0, 12.0)
    assert c["first_speech"] == 2.0 and c["span_s"] == 7.0
    assert c["pauses"] == [pytest.approx(1.0)] and c["runs"] == 2
    measured = fluency.rates(c, [2.0])
    assert measured["silent_pauses_per_min"] == pytest.approx(60 / 7, abs=0.01)
    assert measured["mean_silent_pause_ms"] == 1000 and measured["response_latency_s"] == 2.0


def test_syllables_come_from_words_and_fillers_are_left_out():
    words = [
        Word(0.0, 0.3, "Um,"),
        Word(0.4, 0.8, "a"),
        Word(0.9, 1.4, "stack"),
        Word(1.5, 2.0, "removes"),
    ]
    c = fluency.counts([(0.0, 2.0)], [0.1, 0.5, 1.1, 1.6, 1.8], words, 0.0, 2.0)
    assert c["fillers"] == 1 and c["words"] == 3
    assert c["syllables"] == 4  # a + stack + re-moves
    assert c["syllables_acoustic"] == 4  # 5 nuclei minus 1 filler


def test_mid_clause_and_boundary_pauses():
    words = [
        Word(0, 0.5, "the"),
        Word(0.5, 1.0, "last"),
        Word(2.0, 2.5, "item."),
        Word(3.5, 4.0, "Then"),
    ]
    assert fluency.pause_position(words, 1.0, 2.0) == "mid"
    assert fluency.pause_position(words, 2.5, 3.5) == "end"
    # Transcribers write commas and "..." where people pause: those are not boundaries.
    paused = [
        Word(0, 0.5, "queue"),
        Word(0.5, 1.0, "is..."),
        Word(2.0, 2.5, "first"),
        Word(2.6, 3.0, "in,"),
        Word(4.0, 4.5, "out"),
    ]
    assert fluency.pause_position(paused, 1.0, 2.0) == "mid"
    assert fluency.pause_position(paused, 3.0, 4.0) == "mid"


def test_session_total_and_literature_flags():
    a = fluency.counts([(0, 10)], [], [Word(i, i + 0.5, "word") for i in range(10)], 0, 10)
    b = fluency.counts(
        [(20, 25), (27, 30)], [], [Word(20 + i, 20.5 + i, "item") for i in range(5)], 15, 30
    )
    session = fluency.rates(fluency.total([a, b]))
    assert session["speaking_time_s"] == 20 and session["silent_pauses"] == 1
    slow = {
        "speech_rate_syll_s": 1.5,
        "articulation_rate_syll_s": 3.0,
        "mean_length_of_run_syll": 3.0,
        "mean_silent_pause_ms": 500,
    }
    assert fluency.flags(slow) == ["speech_rate_syll_s", "mean_length_of_run_syll"]
    assert fluency.communication_flagged(slow)
    assert not fluency.communication_flagged({"speech_rate_syll_s": 1.5})


def test_counting_check_counts_only_noticeable_pauses():
    speech = [(0, 1), (1.3, 2), (2.8, 4)]  # gaps 0.3 s (not noticed) and 0.8 s (noticed)
    heard = fluency.noticed(speech, [Word(1.5, 1.7, "uh")], 0, 4)
    assert heard == {"fillers": 1, "pauses": 1}


def test_windows_cover_the_answer():
    rows = fluency.windows([(0, 14), (16, 40)], [], [], 0, 40)
    assert [r["window_start_s"] for r in rows] == [0, 15, 30]


@pytest.mark.parametrize(
    "word, n",
    [("stack", 1), ("where", 1), ("item", 2), ("queue", 1), ("enqueue", 2), ("used", 1),
     ("scheduling", 3), ("table", 2), ("makes", 1), ("operations", 4), ("2", 1), ("", 0)],
)  # fmt: skip
def test_count_syllables(word, n):
    assert count_syllables(word) == n


def test_syllable_nuclei_on_synthetic_bursts():
    pytest.importorskip("parselmouth")
    from app.integrations.syllables import syllable_nuclei

    sr = 16000
    t = np.arange(int(0.18 * sr)) / sr
    burst = 0.5 * np.sin(2 * np.pi * 150 * t) * np.hanning(len(t))  # one voiced "syllable"
    gap = np.zeros(int(0.12 * sr))
    signal = np.concatenate([gap] + [np.concatenate([burst, gap]) for _ in range(6)])
    assert len(syllable_nuclei(signal, sr)) == 6


def test_answer_profile_measures_one_answer_like_the_research_tool():
    speech = [(0.0, 4.0), (4.5, 8.0), (8.3, 12.0)]  # pauses of 0.5 s and 0.3 s, both counted
    words = [Word(i * 0.5, i * 0.5 + 0.3, "stack") for i in range(24)]  # 24 syllables
    p = fluency.answer_profile(speech, words)
    assert set(p) == set(fluency.PROFILE_KEYS)
    assert p["speaking_time_s"] == 12.0 and p["speech_rate_syll_s"] == 2.0
    assert p["silent_pauses"] == 2 and p["mean_silent_pause_ms"] == 400
    assert p["mean_length_of_run_syll"] == 8.0 and p["articulation_rate_syll_s"] == 2.143
    assert fluency.flags(p) == ["articulation_rate_syll_s"]  # one measure: not the pattern
    assert fluency.answer_profile(speech, []) is None
    assert fluency.answer_profile(speech, [Word(1.0, 1.4, "um"), Word(2.0, 2.3, "uh")]) is None
