"""Speech fluency measures for the communication-gap research (PP1, October 2026).

Pure functions over timings, no audio or network: speech intervals from voice activity
detection, syllable nucleus times, and word timings from a transcriber. Times are in
seconds. Rates are per minute of speaking time, measured from the first to the last
speech inside a segment, so silence before the first word (response latency) and after
the last word is never counted as a pause.

Definitions follow the L2 fluency literature cited in docs/c4/research-scope-change.md:
silent pauses of 250 ms or more (De Jong and Bosker, 2013); speech rate and articulation
rate in syllables per second; mean length of run in syllables between silent pauses.
"""

import re
from dataclasses import dataclass
from statistics import mean

SILENT_PAUSE_S = 0.25  # De Jong and Bosker (2013): 250 to 300 ms best predicts L2 proficiency
NOTICEABLE_PAUSE_S = 0.5  # what a listener reliably notices; used by the counting check
LONG_PAUSE_S = 2.0
WINDOW_S = 15.0

FILLER = re.compile(r"^\W*(u+h+|u+m+|uhm+|e+r+m*|h+m+|m{2,}|a+h+)\W*$", re.IGNORECASE)
# Words that usually start a new clause; a pause before one counts as a clause-boundary pause.
# Ambiguous words are left out: "first" ("first in, first out"), "that" ("that item"), "for".
CLAUSE_STARTS = {
    "and", "but", "so", "because", "then", "which", "when", "if", "or", "after", "before",
    "while", "where", "who", "since", "although", "though", "finally",
}  # fmt: skip


@dataclass(frozen=True)
class Word:
    start: float
    end: float
    text: str


def is_filler(text):
    return bool(FILLER.match(text.strip()))


def count_syllables(word):
    """Approximate English syllables of one written word (vowel groups, silent endings)."""
    w = re.sub(r"[^a-z]", "", word.lower())
    if not w:
        return 1 if re.search(r"\d", word) else 0
    n = len(re.findall(r"[aeiou]+|(?<=[^aeiou])y", w))
    if n > 1 and re.search(r"[^aeiou]e$", w) and not re.search(r"[^aeiou]le$", w):
        n -= 1  # silent final e: make, one, where
    elif n > 1 and re.search(r"[^td]ed$", w):
        n -= 1  # silent -ed: used, arrived
    elif n > 1 and re.search(r"[^aeiouszxh]es$", w) and not w.endswith("ces"):
        n -= 1  # silent -es: makes
    return max(n, 1)


def merge(intervals):
    """Sorted, overlap-free (start, end) intervals."""
    merged = []
    for start, end in sorted((s, e) for s, e in intervals if e > s):
        if merged and start <= merged[-1][1]:
            merged[-1] = (merged[-1][0], max(end, merged[-1][1]))
        else:
            merged.append((start, end))
    return merged


def clip(intervals, start, end):
    return [(max(s, start), min(e, end)) for s, e in intervals if e > start and s < end]


def pause_position(words, pause_start, pause_end):
    """'end' for a pause at a likely clause boundary, 'mid' inside a clause, None if unknown.

    Approximate: a boundary is a sentence end (. ? !) on the word before the pause, or a
    clause-starting word after it. Commas and "..." are ignored, because transcribers put
    them exactly where people pause. Fillers are skipped when looking for neighbours.
    """
    content = [w for w in words if not is_filler(w.text)]
    before = [w for w in content if w.end <= pause_start + 0.05]
    after = [w for w in content if w.start >= pause_end - 0.05]
    if not before or not after:
        return None
    previous, following = before[-1].text.strip(), after[0].text.strip()
    sentence_end = previous[-1:] in ".?!" and not previous.endswith("..")
    if sentence_end or re.sub(r"\W", "", following.lower()) in CLAUSE_STARTS:
        return "end"
    return "mid"


def counts(speech, syllables, words, start, end):
    """Raw counts and durations for one segment of a student's recording."""
    inside = clip(merge(speech), start, end)
    if not inside:
        return None
    first, last = inside[0][0], inside[-1][1]
    pauses = [
        (a_end, b_start)
        for (_, a_end), (b_start, _) in zip(inside, inside[1:], strict=False)
        if b_start - a_end >= SILENT_PAUSE_S
    ]
    span_words = [w for w in words if w.start >= first - 0.1 and w.end <= last + 0.1]
    fillers = [w for w in span_words if is_filler(w.text)]
    positions = [pause_position(span_words, a, b) for a, b in pauses]
    nuclei = sum(1 for t in syllables if any(s <= t <= e for s, e in inside))
    spoken = sum(count_syllables(w.text) for w in span_words if not is_filler(w.text))
    return {
        "span_s": last - first,
        "phonation_s": sum(e - s for s, e in inside),
        "pauses": [b - a for a, b in pauses],
        "fillers": len(fillers),
        # Syllables of the transcribed words, fillers left out, as the fluency literature
        # counts them; the acoustic count (one nucleus per filler removed) is the fallback
        # without a transcript and a cross-check with one.
        "syllables": spoken if span_words else max(nuclei - len(fillers), 0),
        "syllables_acoustic": max(nuclei - len(fillers), 0),
        "words": len(span_words) - len(fillers),
        "runs": len(pauses) + 1,
        "mid_clause": positions.count("mid"),
        "end_clause": positions.count("end"),
        "first_speech": first,
    }


def total(parts):
    """Add up the counts of several segments, for whole-session measures."""
    parts = [p for p in parts if p]
    if not parts:
        return None
    result = {
        key: sum(p[key] for p in parts) for key in parts[0] if key not in ("pauses", "first_speech")
    }
    result["pauses"] = [d for p in parts for d in p["pauses"]]
    return result


def rates(c, latencies=()):
    """Fluency measures from counts; None where a measure cannot be computed."""
    latencies = [x for x in latencies if x is not None]
    if not c or c["span_s"] <= 0:
        return None
    minutes = c["span_s"] / 60
    located = c["mid_clause"] + c["end_clause"]
    return {
        "speaking_time_s": round(c["span_s"], 2),
        "silent_pauses_per_min": round(len(c["pauses"]) / minutes, 2),
        "mean_silent_pause_ms": round(mean(c["pauses"]) * 1000) if c["pauses"] else None,
        "long_pauses_per_min": round(sum(d >= LONG_PAUSE_S for d in c["pauses"]) / minutes, 2),
        "filled_pauses_per_min": round(c["fillers"] / minutes, 2),
        "filled_pauses_per_100_words": round(100 * c["fillers"] / c["words"], 2)
        if c["words"]
        else None,
        "speech_rate_syll_s": round(c["syllables"] / c["span_s"], 3),
        "articulation_rate_syll_s": round(c["syllables"] / c["phonation_s"], 3)
        if c["phonation_s"]
        else None,
        "mean_length_of_run_syll": round(c["syllables"] / c["runs"], 2),
        "phonation_time_ratio": round(c["phonation_s"] / c["span_s"], 3),
        "mid_clause_pause_share": round(c["mid_clause"] / located, 3) if located else None,
        "response_latency_s": round(mean(latencies), 2) if latencies else None,
        "silent_pauses": len(c["pauses"]),
        "filled_pauses": c["fillers"],
        "syllables": c["syllables"],
        "syllables_acoustic": c["syllables_acoustic"],
        "words": c["words"],
    }


def windows(speech, syllables, words, start, end, size=WINDOW_S):
    """Measures for consecutive windows of `size` seconds, for a timeline of one answer."""
    result, t = [], start
    while t < end:
        stop = min(t + size, end)
        c = counts(speech, syllables, words, t, stop)
        measured = rates(c)
        if measured:
            result.append(
                {"window_start_s": round(t, 2), "window_end_s": round(stop, 2), **measured}
            )
        t = stop
    return result


def noticed(speech, words, start, end):
    """What a listener counts in the counting check: fillers and pauses of 0.5 s or more."""
    inside = clip(merge(speech), start, end)
    gaps = [b - a for (_, a), (b, _) in zip(inside, inside[1:], strict=False)]
    return {
        "fillers": sum(1 for w in words if start <= w.start < end and is_filler(w.text)),
        "pauses": sum(1 for g in gaps if g >= NOTICEABLE_PAUSE_S),
    }


# Provisional PP1 profile: one standard deviation worse than the mean of intermediate
# (B1 to B2) L2 English speakers, from 61 Chinese learners of English giving IELTS-style
# monologues (Journal of the European Second Language Association, 10.22599/jesla.124).
# A different first language and task: to be replaced by values derived from the pilot.
LITERATURE_PROFILE = {
    "name": "literature-2026-10",
    "min_flags": 2,
    "rules": {
        "speech_rate_syll_s": ("below", 1.97),  # mean 2.43, SD 0.46
        "articulation_rate_syll_s": ("below", 2.83),  # mean 3.25, SD 0.42
        "mean_length_of_run_syll": ("below", 3.43),  # mean 5.89, SD 2.46
        "mean_silent_pause_ms": ("above", 687),  # mean 564, SD 123
    },
}


def flags(measured, profile=LITERATURE_PROFILE):
    """Names of the profile's measures that are beyond their threshold."""
    result = []
    for name, (direction, cut) in profile["rules"].items():
        value = measured.get(name) if measured else None
        if value is not None and (value < cut if direction == "below" else value > cut):
            result.append(name)
    return result


def communication_flagged(measured, profile=LITERATURE_PROFILE):
    return len(flags(measured, profile)) >= profile["min_flags"]


# The live viva judges one answer at a time; shorter answers give unstable rates.
MIN_PROFILE_SPEECH_S = 10.0
PROFILE_KEYS = (
    "speaking_time_s",
    "speech_rate_syll_s",
    "articulation_rate_syll_s",
    "mean_length_of_run_syll",
    "mean_silent_pause_ms",
    "silent_pauses",
    "syllables",
)


def answer_profile(speech, words):
    """Profile measures of one spoken answer, measured as the research tool measures them;
    None without timed words (syllables come from the transcript, never guessed)."""
    measured = rates(counts(speech, [], words, 0.0, float("inf"))) if words else None
    if not measured or not measured["words"]:
        return None
    return {key: measured[key] for key in PROFILE_KEYS}
