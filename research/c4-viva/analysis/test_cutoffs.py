"""PP2 step 1: test the frozen pilot cut-offs, unchanged, on new students.

The cut-offs are imported from the viva system itself (fluency.PILOT_PROFILE and the filler
and repair cut-offs in logic.py), so this tests exactly what the system uses. Nothing here is
fitted: the pilot students (P01 to P10) and the practice (P00) are left out, so every student
tested is new to the cut-offs.

1. Analyse the new recordings the same way as the pilot (CrisperWhisper words next to each
   recording), from backend/services/viva-service:

       uv run --extra speech --extra research python scripts/analyze_recordings.py RECORDINGS_DIR

2. Then, from the same folder:

       uv run --extra research python ../../../research/c4-viva/analysis/test_cutoffs.py \
           RECORDINGS_DIR/results PARTICIPANTS_CSV

To see how the live system's counter does, run step 1 again with --transcriber groq into a
separate folder and point this script at that results folder. It writes test_report.md into
the results folder and never touches report.md. --include-pilot adds P01 to P10 (a check only:
those students set the cut-offs, so their numbers are not a test). --self-check runs the
built-in check.
"""

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "backend" / "services" / "viva-service"))

from run_stats import GROUPS, number, read  # noqa: E402

from app.domain import fluency, logic  # noqa: E402

PILOT = {f"P{i:02d}" for i in range(0, 11)}  # P00 practice, P01 to P10 set the cut-offs
PROFILE = fluency.PILOT_PROFILE


def signals(row):
    """The three pilot signals for one whole viva, judged as the system judges them."""
    seconds = number(row.get("speaking_time_s")) or 0
    timed = seconds >= fluency.MIN_PROFILE_SPEECH_S
    measured = {name: number(row.get(name)) for name in PROFILE["rules"]}
    repairs = sum(
        int(number(row.get(k)) or 0) for k in ("repetitions", "false_starts", "self_corrections")
    )
    return {
        "fluency": timed and len(fluency.flags(measured, PROFILE)) >= PROFILE["min_flags"],
        "fillers": (number(row.get("filled_pauses")) or 0) >= 2
        and (number(row.get("filled_pauses_per_100_words")) or 0)
        >= logic.PILOT_FILLERS_PER_100_WORDS,
        "repairs": timed
        and repairs >= 2
        and (number(row.get("repairs_per_min")) or 0) >= logic.PILOT_REPAIRS_PER_MIN,
    }


def rules(row):
    found = signals(row)
    count = sum(found.values())
    measured = {name: number(row.get(name)) for name in PROFILE["rules"]}
    flagged = set(fluency.flags(measured, PROFILE))
    return {
        **{f"signal: {k}": v for k, v in found.items()},
        "at least one signal": count >= 1,
        "at least two signals (the system's rule per answer)": count >= 2,
        **{f"measure: {name}": name in flagged for name in PROFILE["rules"]},
    }


def score(predicted, labels):
    tp = sum(p and y for p, y in zip(predicted, labels, strict=True))
    tn = sum(not p and not y for p, y in zip(predicted, labels, strict=True))
    pos, neg = sum(labels), len(labels) - sum(labels)
    return {
        "caught": f"{tp} of {pos}",
        "false alarms": f"{neg - tn} of {neg}",
        "sensitivity": tp / pos if pos else None,
        "specificity": tn / neg if neg else None,
        "accuracy": (tp + tn) / len(labels) if labels else None,
    }


def fmt(x):
    return "n/a" if x is None else f"{x:.2f}"


def main(results_dir, participants_path, include_pilot=False):
    results_dir = Path(results_dir)
    sessions = {r["code"].strip().upper(): r for r in read(results_dir / "sessions.csv")}
    people = [{k: (v or "").strip() for k, v in p.items()} for p in read(participants_path)]
    for p in people:
        p["code"], p["group"] = p["code"].upper().replace("O", "0"), p.get("group", "").lower()
    skip = {"P00"} if include_pilot else PILOT
    people = [p for p in people if p["group"] in GROUPS and p["code"] not in skip]
    rows = [{**sessions[p["code"]], **p} for p in people if p["code"] in sessions]
    missing = [p["code"] for p in people if p["code"] not in sessions]
    labels = [r["group"] == "difficulty" for r in rows]
    if not rows:
        sys.exit("No students with a group and a recording. Check the codes and the group column.")

    cut = {k: v[1] for k, v in PROFILE["rules"].items()}
    report = [
        "# PP2 step 1: frozen pilot cut-offs on new students",
        "",
        f"Students: {sum(labels)} difficulty, {len(labels) - sum(labels)} comfortable"
        + (
            " (pilot students included: a check, not a test)."
            if include_pilot
            else ", all new to the cut-offs."
        )
        + (f" Missing recordings: {', '.join(missing)}." if missing else ""),
        f"Transcript source: {', '.join(sorted({r.get('transcript_source', '?') for r in rows}))}.",
        "",
        f"Cut-offs (unchanged, `{PROFILE['name']}`): speech rate < {cut['speech_rate_syll_s']}, articulation "
        f"< {cut['articulation_rate_syll_s']}, run < {cut['mean_length_of_run_syll']}, pause > "
        f"{cut['mean_silent_pause_ms']} ms (fluency signal: {PROFILE['min_flags']} of 4, at least "
        f"{fluency.MIN_PROFILE_SPEECH_S:g} s of speech); fillers {logic.PILOT_FILLERS_PER_100_WORDS} per 100 words "
        f"and at least 2; repairs {logic.PILOT_REPAIRS_PER_MIN} per minute and at least 2.",
        "",
        "| Rule | Caught (difficulty) | False alarms (comfortable) | Sensitivity | Specificity | Accuracy |",
        "|---|---|---|---|---|---|",
    ]
    judged = [rules(r) for r in rows]
    for name in judged[0]:
        s = score([j[name] for j in judged], labels)
        report.append(
            f"| {name} | {s['caught']} | {s['false alarms']} | {fmt(s['sensitivity'])} | "
            f"{fmt(s['specificity'])} | {fmt(s['accuracy'])} |"
        )
    report += [
        "",
        "Accuracy 0.50 is chance for equal groups. Results here are combined; never publish them per student.",
    ]
    out = results_dir / "test_report.md"
    out.write_text("\n".join(report) + "\n", encoding="utf-8")
    print("\n".join(report[6:]))
    print(f"\nWrote {out}")


def self_check():
    hard = {
        "speaking_time_s": "60",
        "speech_rate_syll_s": "2.0",
        "articulation_rate_syll_s": "3.0",
        "mean_length_of_run_syll": "4",
        "mean_silent_pause_ms": "900",
        "filled_pauses": "8",
        "filled_pauses_per_100_words": "9",
        "repetitions": "2",
        "false_starts": "1",
        "self_corrections": "0",
        "repairs_per_min": "3",
    }
    easy = {
        **hard,
        "speech_rate_syll_s": "3.5",
        "articulation_rate_syll_s": "4.5",
        "mean_length_of_run_syll": "9",
        "mean_silent_pause_ms": "400",
        "filled_pauses": "1",
        "filled_pauses_per_100_words": "1",
        "repetitions": "0",
        "false_starts": "0",
        "repairs_per_min": "0",
    }
    assert signals(hard) == {"fluency": True, "fillers": True, "repairs": True}
    assert signals(easy) == {"fluency": False, "fillers": False, "repairs": False}
    assert not signals({**hard, "speaking_time_s": "5"})["fluency"]  # under 10 s: not judged
    assert not signals({**hard, "filled_pauses": "1"})["fillers"]  # one "um" never counts alone
    s = score([True, False, True, False], [True, True, False, False])
    assert (s["sensitivity"], s["specificity"], s["accuracy"]) == (0.5, 0.5, 0.5)
    print("self-check passed")


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    if "--self-check" in sys.argv:
        self_check()
    elif len(args) == 2:
        main(*args, include_pilot="--include-pilot" in sys.argv)
    else:
        sys.exit(__doc__)
