"""Statistics for the PP1 communication-gap pilot.

Reads the results of scripts/analyze_recordings.py and your participants sheet, then
writes report.md, summary.csv and one chart per measure into the results folder.

Run from backend/services/viva-service (it uses that Python environment):

    uv run --extra research python ../../../research/c4-viva/analysis/run_stats.py \
        RECORDINGS_DIR/results ../../../research/c4-viva/study/participants.csv

participants.csv columns: code, group (difficulty or comfortable), mcq_score,
self_report, observer, notes. Only rows with a group are analysed.
"""

import csv
import sys
from pathlib import Path

import numpy as np
from scipy.stats import mannwhitneyu, spearmanr

# (column, label, direction in the difficulty group: "lower" or "higher")
# The first four are the primary measures named in hypothesis H1, decided before the data
# is seen. Only they share the Holm correction: with 5 + 5 students, correcting over all
# eleven measures could never reach p < 0.05. The rest are exploratory.
PRIMARY = {
    "speech_rate_syll_s",
    "mean_length_of_run_syll",
    "mean_silent_pause_ms",
    "silent_pauses_per_min",
}
MEASURES = [
    ("speech_rate_syll_s", "Speech rate (syllables/s)", "lower"),
    ("articulation_rate_syll_s", "Articulation rate (syllables/s)", "lower"),
    ("mean_length_of_run_syll", "Mean length of run (syllables)", "lower"),
    ("mean_silent_pause_ms", "Mean silent pause (ms)", "higher"),
    ("silent_pauses_per_min", "Silent pauses per minute", "higher"),
    ("long_pauses_per_min", "Pauses of 2 s or more per minute", "higher"),
    ("mid_clause_pause_share", "Share of pauses inside clauses", "higher"),
    ("filled_pauses_per_min", "Filled pauses per minute", "higher"),
    ("filled_pauses_per_100_words", "Filled pauses per 100 words", "higher"),
    ("response_latency_s", "Response latency (s)", "higher"),
    ("phonation_time_ratio", "Phonation time ratio", "lower"),
]
# Same numbers as LITERATURE_PROFILE in backend/services/viva-service/app/domain/fluency.py.
LITERATURE = {
    "speech_rate_syll_s": 1.97,
    "articulation_rate_syll_s": 2.83,
    "mean_length_of_run_syll": 3.43,
    "mean_silent_pause_ms": 687,
}
GROUPS = ("difficulty", "comfortable")


def read(path):
    with open(path, newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def number(value):
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def classify(value, cut, direction):
    return value < cut if direction == "lower" else value > cut


def best_cut(values, labels, direction):
    """Cut-off with the highest Youden J (sensitivity + specificity - 1)."""
    points = sorted(set(values))
    candidates = [(a + b) / 2 for a, b in zip(points, points[1:], strict=False)] or points
    best = None
    for cut in candidates:
        predicted = [classify(v, cut, direction) for v in values]
        tp = sum(p and y for p, y in zip(predicted, labels, strict=True))
        tn = sum(not p and not y for p, y in zip(predicted, labels, strict=True))
        sens, spec = tp / max(sum(labels), 1), tn / max(len(labels) - sum(labels), 1)
        if best is None or sens + spec > best[1] + best[2]:
            best = (cut, sens, spec)
    return best


def leave_one_out(values, labels, direction):
    """Accuracy when each student is classified by a cut-off set on all the others."""
    hits = 0
    for i in range(len(values)):
        rest_v, rest_y = values[:i] + values[i + 1 :], labels[:i] + labels[i + 1 :]
        if len(set(rest_y)) < 2:
            return None
        cut = best_cut(rest_v, rest_y, direction)[0]
        hits += classify(values[i], cut, direction) == labels[i]
    return hits / len(values)


def holm(pvalues):
    order = sorted(range(len(pvalues)), key=lambda i: pvalues[i])
    adjusted, running = [None] * len(pvalues), 0.0
    for rank, i in enumerate(order):
        running = max(running, min(1.0, (len(pvalues) - rank) * pvalues[i]))
        adjusted[i] = running
    return adjusted


def chart(path, label, groups, cut, literature):
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    fig, ax = plt.subplots(figsize=(4.2, 3.6))
    for x, name in enumerate(GROUPS):
        ys = groups[name]
        ax.scatter([x + (j - len(ys) / 2) * 0.03 for j in range(len(ys))], ys, s=36, zorder=3)
        if ys:
            ax.hlines(np.median(ys), x - 0.25, x + 0.25, colors="black", linewidth=2)
    if cut is not None:
        ax.axhline(
            cut, color="tab:green", linestyle="--", linewidth=1, label="best cut-off (pilot)"
        )
    if literature is not None:
        ax.axhline(
            literature, color="tab:red", linestyle=":", linewidth=1.5, label="literature threshold"
        )
    ax.set_xticks([0, 1], ["Communication\ndifficulty", "Comfortable"])
    ax.set_xlim(-0.6, 1.6)
    ax.set_title(label, fontsize=10)
    if cut is not None or literature is not None:
        ax.legend(fontsize=7, loc="best")
    fig.tight_layout()
    fig.savefig(path, dpi=150)
    plt.close(fig)


def fmt(x, digits=3):
    return "n/a" if x is None else f"{x:.{digits}f}"


def main(results_dir, participants_path):
    results_dir = Path(results_dir)
    sessions = {r["code"]: r for r in read(results_dir / "sessions.csv")}
    people = [p for p in read(participants_path) if p.get("group", "").strip() in GROUPS]
    rows = [{**sessions[p["code"]], **p} for p in people if p["code"] in sessions]
    missing = [p["code"] for p in people if p["code"] not in sessions]
    labels = [r["group"].strip() == "difficulty" for r in rows]
    report = [
        "# PP1 pilot results: communication difficulty in L2 technical vivas",
        "",
        f"Participants analysed: {sum(labels)} difficulty, {len(labels) - sum(labels)} comfortable."
        + (f" Missing recordings for: {', '.join(missing)}." if missing else ""),
        "",
    ]

    # 1. Knowledge was similar?
    mcq = {g: [number(r.get("mcq_score")) for r in rows if r["group"].strip() == g] for g in GROUPS}
    mcq = {g: [v for v in vals if v is not None] for g, vals in mcq.items()}
    report += ["## 1. Knowledge check (MCQ)", ""]
    if all(mcq.values()):
        p = mannwhitneyu(mcq["difficulty"], mcq["comfortable"], alternative="two-sided").pvalue
        report += [
            f"Median MCQ score: difficulty {np.median(mcq['difficulty']):.0f}, comfortable {np.median(mcq['comfortable']):.0f} "
            f"(Mann-Whitney U, p = {p:.3f}). A p-value above 0.05 means no evidence the groups differed in knowledge.",
            "",
        ]
    else:
        report += ["MCQ scores missing.", ""]

    # 2. Measures
    table, summary, pvalues = [], [], []
    charts = results_dir / "charts"
    charts.mkdir(exist_ok=True)
    for column, label, direction in MEASURES:
        pairs = [(number(r.get(column)), y) for r, y in zip(rows, labels, strict=True)]
        pairs = [(v, y) for v, y in pairs if v is not None]
        groups = {
            "difficulty": [v for v, y in pairs if y],
            "comfortable": [v for v, y in pairs if not y],
        }
        if len(groups["difficulty"]) < 2 or len(groups["comfortable"]) < 2:
            continue
        test = mannwhitneyu(groups["difficulty"], groups["comfortable"], alternative="two-sided")
        n1, n2 = len(groups["difficulty"]), len(groups["comfortable"])
        prob_higher = test.statistic / (
            n1 * n2
        )  # chance a difficulty value exceeds a comfortable one
        auc = prob_higher if direction == "higher" else 1 - prob_higher
        values, ys = [v for v, _ in pairs], [y for _, y in pairs]
        cut, sens, spec = best_cut(values, ys, direction)
        loo = leave_one_out(values, ys, direction)
        lit = LITERATURE.get(column)
        lit_acc = (
            sum(classify(v, lit, direction) == y for v, y in pairs) / len(pairs)
            if lit is not None
            else None
        )
        pvalues.append(test.pvalue)
        summary.append(
            {
                "measure": column,
                "direction_expected": direction,
                "median_difficulty": float(np.median(groups["difficulty"])),
                "median_comfortable": float(np.median(groups["comfortable"])),
                "p_value": test.pvalue,
                "auc": auc,
                "best_cut": cut,
                "sensitivity": sens,
                "specificity": spec,
                "leave_one_out_accuracy": loo,
                "literature_threshold": lit,
                "literature_accuracy": lit_acc,
            }
        )
        chart(charts / f"{column}.png", label, groups, cut, lit)
        table.append(label)
    primary = [i for i, row in enumerate(summary) if row["measure"] in PRIMARY]
    for i, adjusted in zip(primary, holm([pvalues[i] for i in primary]), strict=True):
        summary[i]["p_holm"] = adjusted
    for row in summary:
        row.setdefault("p_holm", None)
        row["role"] = "primary" if row["measure"] in PRIMARY else "exploratory"

    report += [
        "## 2. Do the groups differ?",
        "",
        "AUC is the chance that a randomly chosen difficulty student is on the expected side of a randomly chosen comfortable student (0.5 = no difference, 1.0 = perfect separation). The four primary measures (hypothesis H1) share a Holm correction; a primary measure is significant when p (Holm) is below 0.05. Exploratory measures are reported without correction and prove nothing on their own.",
        "",
        "| Measure | Role | Median difficulty | Median comfortable | p | p (Holm) | AUC |",
        "|---|---|---|---|---|---|---|",
    ]
    for label, row in zip(table, summary, strict=True):
        report.append(
            f"| {label} | {row['role']} | {fmt(row['median_difficulty'], 2)} | {fmt(row['median_comfortable'], 2)} | {fmt(row['p_value'])} | {fmt(row['p_holm'])} | {fmt(row['auc'], 2)} |"
        )
    report += [
        "",
        "## 3. Thresholds: literature vs this pilot",
        "",
        "Best cut-off: the value that sorts most students correctly in this pilot (Youden J). Leave-one-out: accuracy when each student is classified by a cut-off set on the others, the honest estimate for new students.",
        "",
        "| Measure | Literature threshold | Literature accuracy | Pilot cut-off | Sensitivity | Specificity | Leave-one-out accuracy |",
        "|---|---|---|---|---|---|---|",
    ]
    for label, row in zip(table, summary, strict=True):
        report.append(
            f"| {label} | {fmt(row['literature_threshold'], 2)} | {fmt(row['literature_accuracy'], 2)} | {fmt(row['best_cut'], 2)} | {fmt(row['sensitivity'], 2)} | {fmt(row['specificity'], 2)} | {fmt(row['leave_one_out_accuracy'], 2)} |"
        )

    # 4. The literature rule used by the system (2 of 4 core measures)
    flagged = [r.get("literature_flagged") == "True" for r in rows]
    tp = sum(f and y for f, y in zip(flagged, labels, strict=True))
    tn = sum(not f and not y for f, y in zip(flagged, labels, strict=True))
    report += [
        "",
        "## 4. The PP1 rule in the system",
        "",
        f"Literature profile (2 of 4 core measures beyond threshold): caught {tp} of {sum(labels)} difficulty students; "
        f"wrongly flagged {len(labels) - sum(labels) - tn} of {len(labels) - sum(labels)} comfortable students.",
        "",
    ]

    # 5. Counting check
    checks = (
        read(results_dir / "count_check.csv") if (results_dir / "count_check.csv").exists() else []
    )
    done = [
        (
            number(c["tool_fillers"]),
            number(c["your_fillers"]),
            number(c["tool_pauses"]),
            number(c["your_pauses"]),
        )
        for c in checks
        if number(c.get("your_fillers")) is not None and number(c.get("your_pauses")) is not None
    ]
    report += ["## 5. Counting check (tool vs your ears)", ""]
    if done:
        for name, a, b in (("Fillers", 0, 1), ("Pauses", 2, 3)):
            tool, human = [d[a] for d in done], [d[b] for d in done]
            within = sum(abs(t - h) <= 1 for t, h in zip(tool, human, strict=True))
            line = f"{name}: within one of your count for {within} of {len(done)} students; mean difference {np.mean(np.abs(np.subtract(tool, human))):.1f}"
            if len(done) >= 3 and len(set(tool)) > 1 and len(set(human)) > 1:
                line += f"; Spearman rho {spearmanr(tool, human)[0]:.2f}"
            report.append(line + ".")
    else:
        report.append(
            "Not filled in yet: add your counts to the your_fillers and your_pauses columns of count_check.csv."
        )
    report += [
        "",
        "## Notes",
        "",
        "- Pilot sample: with 5 + 5 students only large differences can reach p < 0.05. Treat results as preliminary; PP2 tests the cut-offs on new students.",
        "- Groups were chosen by self-report at the extremes, which makes separation easier than in a normal class.",
        "- Literature thresholds come from intermediate L2 English monologues, not technical vivas.",
        "- Charts: charts/<measure>.png (green dashed = pilot cut-off, red dotted = literature threshold).",
    ]
    (results_dir / "report.md").write_text("\n".join(report) + "\n", encoding="utf-8")
    with open(results_dir / "summary.csv", "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=list(summary[0]))
        writer.writeheader()
        writer.writerows(summary)
    print(f"Wrote {results_dir / 'report.md'}")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    main(sys.argv[1], sys.argv[2])
