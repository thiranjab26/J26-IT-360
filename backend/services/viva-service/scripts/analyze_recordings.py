"""Measure speech fluency in recorded viva sessions (the PP1 communication-gap study).

Put each session's Zoom files in one folder, named by participant code:

    P01_student.m4a     the student's voice (required)
    P01_examiner.m4a    your voice (required; splits the session per question so listening
                        time and thinking time are not counted as the student's pauses)
    P01_student.words.json   word timings from the CrisperWhisper notebook (optional;
                        otherwise the student file is transcribed here)

Run from backend/services/viva-service:

    uv run --extra speech --extra research python scripts/analyze_recordings.py RECORDINGS_DIR

It writes sessions.csv, answers.csv, windows.csv and count_check.csv (plus one JSON file
per participant) to RECORDINGS_DIR/results. Recordings never leave this computer unless
you choose --transcriber groq. The analysis itself is app/integrations/recording.py, which
the admin "Analyse a recording" page also uses.
"""

import argparse
import csv
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.integrations import recording  # noqa: E402

AUDIO = (".m4a", ".mp3", ".wav", ".mp4", ".webm", ".ogg", ".flac")
# Other transcribers drop most fillers and repairs, and a 0 would read as fluent speech, so
# without a CrisperWhisper file these stay blank and the statistics skip them.
VERBATIM_ONLY = (
    "filled_pauses_per_min", "filled_pauses_per_100_words", "filled_pauses", "repairs_per_min",
    "lexical_fillers_per_min", "repetitions", "false_starts", "self_corrections",
    "lexical_fillers", "word_searches", "warmup_filled_pauses_per_min",
)  # fmt: skip


def clock(seconds):
    return f"{int(seconds // 60):02d}:{int(seconds % 60):02d}"


def seconds(text):
    """'1:28' or '01:28' (or Excel's '1:28:00') as seconds."""
    minutes, secs = text.split(":")[:2]
    return int(minutes) * 60 + int(secs)


def find(folder, stem):
    return next((p for p in folder.iterdir() if p.stem == stem and p.suffix.lower() in AUDIO), None)


def listened(typed):
    """The stretch you counted, once you typed counts for it, so a re-run counts the same one."""
    if typed.get("listen_from") and typed.get("listen_to") and any(
        v for k, v in typed.items() if k.startswith("your_")
    ):
        return seconds(typed["listen_from"]), seconds(typed["listen_to"])
    return None


def analyse(code, folder, args, check_window=None):
    student = find(folder, f"{code}_student")
    examiner = find(folder, f"{code}_examiner")
    print(f"{code}: decoding and detecting speech", flush=True)
    content = student.read_bytes()
    audio = recording.decode(content)
    nuclei = recording.syllables(audio)
    words_file = folder / f"{code}_student.words.json"
    if words_file.exists():
        words = recording.words_from_json(json.loads(words_file.read_text(encoding="utf-8")))
        source = "crisperwhisper"
    elif args.transcriber == "none":
        words, source = [], "none"
    else:
        print(f"{code}: transcribing ({args.transcriber})", flush=True)
        words = recording.transcribe(
            content, student.suffix, audio, args.transcriber, args.whisper_model
        )
        source = args.transcriber
    examiner_speech = (
        recording.speech_intervals(recording.decode(examiner.read_bytes())) if examiner else None
    )
    result = recording.analyse(
        audio,
        words,
        nuclei,
        examiner_speech,
        warmup=args.warmup,
        check_answer=args.check_answer,
        check_seconds=args.check_seconds,
        check_window=check_window,
    )
    summary = {"code": code, "transcript_source": source, **result["session"]}
    rows = [{"code": code, **r} for r in result["answers"]]
    window_rows = [{"code": code, **w} for w in result["windows"]]
    verbatim = source == "crisperwhisper"
    if not verbatim:
        print(f"{code}: no CrisperWhisper words file, fillers and repairs left blank", flush=True)
        for row in (summary, *rows, *window_rows):
            row.update({k: "" for k in VERBATIM_ONLY if k in row})
    count_row = {"code": code}
    if result["check"]:
        check = result["check"]
        count_row.update(
            {
                "listen_in": student.name,
                "listen_from": clock(check["begin"]),
                "listen_to": clock(check["finish"]),
                "tool_fillers": check["fillers"] if verbatim else "",
                "tool_repairs": check["repairs"] if verbatim else "",
                "tool_pauses_1s": check["pauses"],
                "your_fillers": "",
                "your_repairs": "",
                "your_pauses_1s": "",
            }
        )
    detail = {
        "code": code,
        "student_file": student.name,
        "examiner_file": examiner.name if examiner else None,
        "duration_s": result["duration_s"],
        "speech_intervals": [[round(s, 3), round(e, 3)] for s, e in result["speech"]],
        "syllable_nuclei": [round(t, 3) for t in nuclei],
        "words": [{"start": w.start, "end": w.end, "word": w.text} for w in words],
        "question_turns": [[round(s, 3), round(e, 3)] for s, e in result["turns"]],
    }
    return summary, rows, window_rows, count_row, detail


def read_typed(path):
    """count_check.csv as you left it, by participant code."""
    if not path.exists():
        return {}
    with path.open(newline="", encoding="utf-8") as f:
        return {r["code"]: r for r in csv.DictReader(f)}


def keep_your_counts(typed, rows):
    """Carry the counts you typed into count_check.csv over to the new file."""
    for row in rows:
        old = typed.get(row["code"], {})
        row.update({k: old[k] for k in row if k.startswith("your_") and old.get(k)})
    return rows


def write_csv(path, rows):
    if not rows:
        return
    keys = list(dict.fromkeys(k for r in rows for k in r))
    with path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=keys)
        writer.writeheader()
        writer.writerows(rows)


def main():
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("folder", type=Path)
    parser.add_argument("--transcriber", choices=["local", "groq", "none"], default="local")
    parser.add_argument("--whisper-model", default="small.en")
    parser.add_argument(
        "--warmup",
        action="store_true",
        help="the first answer is the warm-up; report it separately",
    )
    parser.add_argument(
        "--check-answer", type=int, default=2, help="answer used for the counting check"
    )
    parser.add_argument("--check-seconds", type=float, default=60.0)
    args = parser.parse_args()
    folder = args.folder
    codes = sorted(
        {
            p.stem[: -len("_student")]
            for p in folder.iterdir()
            if p.stem.endswith("_student") and p.suffix.lower() in AUDIO
        }
    )
    if not codes:
        sys.exit(f"No *_student audio files found in {folder}")
    out = folder / "results"
    out.mkdir(exist_ok=True)
    typed = read_typed(out / "count_check.csv")
    sessions, answers, windows, checks = [], [], [], []
    for code in codes:
        if not find(folder, f"{code}_examiner"):
            # Without the examiner's track the whole viva is one answer, so the student's
            # listening and thinking time would count as pauses.
            print(f"{code}: SKIPPED, no {code}_examiner audio file", flush=True)
            continue
        summary, rows, window_rows, count_row, detail = analyse(
            code, folder, args, listened(typed.get(code, {}))
        )
        sessions.append(summary)
        answers += rows
        windows += window_rows
        checks.append(count_row)
        (out / f"{code}.json").write_text(json.dumps(detail, indent=1), encoding="utf-8")
    write_csv(out / "sessions.csv", sessions)
    write_csv(out / "answers.csv", answers)
    write_csv(out / "windows.csv", windows)
    write_csv(out / "count_check.csv", keep_your_counts(typed, checks))
    print(f"Done: {len(codes)} participants. Results in {out}")


if __name__ == "__main__":
    main()
