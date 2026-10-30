"""TODO P6: regenerate every P3/P4 table and figure from the results files.

  python report.py   # reads results/head_pose.json and/or results/expression.json
                     # writes results/report.md and results/figures/*.png

Numbers are only ever copied from those JSON files (CLAUDE.md invariant 6):
rerun head_pose.py / expression.py, then this, and the report updates.
"""

from __future__ import annotations

import json

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np

import common

FIGURES = common.RESULTS / "figures"


def load(name: str) -> dict | None:
    path = common.RESULTS / f"{name}.json"
    if not path.exists():
        return None
    data = json.loads(path.read_text())
    if data.get("dry_run"):
        raise SystemExit(f"{path} is a dry run; rerun the script without --dry-run")
    return data


def confusion_figure(matrix: list[list[int]], labels: list[str], title: str, path) -> None:
    m = np.array(matrix, dtype=float)
    rows = m / np.maximum(m.sum(axis=1, keepdims=True), 1)
    fig, ax = plt.subplots(figsize=(1 + 0.8 * len(labels), 0.8 + 0.8 * len(labels)))
    ax.imshow(rows, cmap="Blues", vmin=0, vmax=1)
    ax.set_xticks(range(len(labels)), labels, rotation=45, ha="right")
    ax.set_yticks(range(len(labels)), labels)
    ax.set_xlabel("predicted")
    ax.set_ylabel("true")
    ax.set_title(title)
    for i in range(len(labels)):
        for j in range(len(labels)):
            ax.text(j, i, f"{rows[i, j]:.2f}\n({int(m[i, j])})", ha="center", va="center",
                    fontsize=7, color="white" if rows[i, j] > 0.5 else "black")
    fig.tight_layout()
    fig.savefig(path, dpi=150)
    plt.close(fig)


def head_pose_section(r: dict) -> list[str]:
    c = r["counts"]
    out = ["## Head pose (P3)", "",
           f"Protocol: {r['protocol']}. Units: {r['units']}.", "",
           f"Test images: {c['test_used']} of {c['test_total']} AFLW2000-3D images "
           f"({c['test_no_face']} with no face found by the app's FaceMesh, "
           f"{c['test_outside_99deg']} outside ±99°). Train {c['train']}, val {c['val']} (300W-LP).", "",
           "| Model | MAE yaw | MAE pitch | MAE roll | MAE mean |", "|---|---|---|---|---|"]
    for name, label in (("geometric", "Geometric (current, no training)"), ("ridge", "Ridge regression"), ("mlp", "MLP (trained)")):
        m = r["results"][name]
        out.append(f"| {label} | {m['mae_yaw']:.2f}° | {m['mae_pitch']:.2f}° | {m['mae_roll']:.2f}° | {m['mae_mean']:.2f}° |")
    out += ["", "Mean absolute error by |yaw| of the test face:", "",
            "| Model | " + " | ".join(r["results"]["mlp"]["by_abs_yaw"]) + " |",
            "|---|" + "---|" * len(r["results"]["mlp"]["by_abs_yaw"])]
    for name in ("geometric", "ridge", "mlp"):
        bins = r["results"][name]["by_abs_yaw"]
        out.append(f"| {name} | " + " | ".join(
            f"{b['mae_mean']:.2f}° (n={b['n']})" if b["mae_mean"] is not None else "–" for b in bins.values()) + " |")
    return out + [""]


def expression_section(r: dict) -> list[str]:
    c = r["counts"]
    t = r["test_raf"]
    labels = list(r["classes"])
    confusion_figure(t["confusion"]["rows_truth_cols_pred"], labels, "Expression, RAF-DB test", FIGURES / "expression_confusion_rafdb.png")
    confusion_figure(t["mood"]["confusion"], list(t["mood"]["classes"]), "Mood, RAF-DB test", FIGURES / "mood_confusion_rafdb.png")
    out = ["## Expression (P4)", "", f"Protocol: {r['protocol']}.", "",
           f"RAF-DB test faces used: {c['raf_test_used']} of {c['raf_test_total']} (rest: no face found by the app's FaceMesh).", "",
           "Training mix chosen on validation macro-F1:", "",
           "| Training mix | Train faces | Val macro-F1 | Val accuracy |", "|---|---|---|---|"]
    for cand in r["candidates"]:
        out.append(f"| {' + '.join(cand['mix'])} | {cand['n_train']} | {cand['val']['macro_f1']:.3f} | {cand['val']['accuracy']:.3f} |")
    out += ["", f"Chosen: **{' + '.join(r['chosen_mix'])}**.", "",
            "| Test set | n | Accuracy | Macro-F1 | Mood accuracy | Mood macro-F1 |", "|---|---|---|---|---|---|",
            f"| RAF-DB test | {t['n']} | {t['accuracy']:.3f} | {t['macro_f1']:.3f} | {t['mood']['accuracy']:.3f} | {t['mood']['macro_f1']:.3f} |"]
    fp = r.get("test_ferplus_privatetest")
    if fp:
        out.append(f"| FER+ PrivateTest | {fp['n']} | {fp['accuracy']:.3f} | {fp['macro_f1']:.3f} | {fp['mood']['accuracy']:.3f} | {fp['mood']['macro_f1']:.3f} |")
    out += ["", "Per-class F1 on RAF-DB test:", "", "| " + " | ".join(labels) + " |", "|" + "---|" * len(labels),
            "| " + " | ".join(f"{t['f1_per_class'][k]:.3f}" for k in labels) + " |", "",
            "Mood: Happy → Positive; Neutral and Surprise → Neutral; Sad, Anger, Fear, Disgust → Negative.", "",
            "![Expression confusion](figures/expression_confusion_rafdb.png)", "",
            "![Mood confusion](figures/mood_confusion_rafdb.png)", ""]
    return out


def tuned_section(r: dict, first: dict | None) -> list[str]:
    t, fp = r["test_raf"], r["test_ferplus_privatetest"]
    labels = list(r["classes"])
    confusion_figure(t["confusion"]["rows_truth_cols_pred"], labels, "Expression (tuned), RAF-DB test",
                     FIGURES / "expression_tuned_confusion_rafdb.png")
    out = ["## Expression, second pass (P4, tuned on validation)", "",
           f"**Test-set use:** {r['test_use_note']}", "",
           f"Protocol: {r['protocol']}.", "",
           "| Mix | Hidden | Dropout | Standardise | Val macro-F1 | Val accuracy | Train acc (last) |",
           "|---|---|---|---|---|---|---|"]
    for tr in r["trials"]:
        out.append(f"| {' + '.join(tr['mix'])} | {tr['hidden']} | {tr['dropout']} | {tr['standardise']} | "
                   f"{tr['val']['macro_f1']:.3f} | {tr['val']['accuracy']:.3f} | {tr['training']['train_accuracy_last']:.3f} |")
    c = r["chosen"]
    out += ["", f"Chosen on validation: {' + '.join(c['mix'])}, hidden {c['hidden']}, dropout {c['dropout']}, "
            f"standardise {c['standardise']}.", "",
            "| Test set | n | Accuracy | Macro-F1 | Mood accuracy | Mood macro-F1 |", "|---|---|---|---|---|---|"]
    if first:
        f = first["test_raf"]
        out.append(f"| RAF-DB test, first run | {f['n']} | {f['accuracy']:.3f} | {f['macro_f1']:.3f} | "
                   f"{f['mood']['accuracy']:.3f} | {f['mood']['macro_f1']:.3f} |")
    out += [f"| RAF-DB test, tuned | {t['n']} | {t['accuracy']:.3f} | {t['macro_f1']:.3f} | {t['mood']['accuracy']:.3f} | {t['mood']['macro_f1']:.3f} |",
            f"| FER+ PrivateTest, tuned | {fp['n']} | {fp['accuracy']:.3f} | {fp['macro_f1']:.3f} | {fp['mood']['accuracy']:.3f} | {fp['mood']['macro_f1']:.3f} |",
            "", "Per-class F1, RAF-DB test, tuned:", "", "| " + " | ".join(labels) + " |", "|" + "---|" * len(labels),
            "| " + " | ".join(f"{t['f1_per_class'][k]:.3f}" for k in labels) + " |", "",
            "![Expression confusion, tuned](figures/expression_tuned_confusion_rafdb.png)", ""]
    return out


def main() -> None:
    FIGURES.mkdir(parents=True, exist_ok=True)
    lines = ["# C2 trained models: results", "",
             "Generated by research/c2-load/training/report.py from results/*.json. Do not edit by hand.", ""]
    hp, ex = load("head_pose"), load("expression")
    if hp:
        lines += head_pose_section(hp)
    if ex:
        lines += expression_section(ex)
    tuned = load("expression_tuned")
    if tuned:
        lines += tuned_section(tuned, ex)
    if not hp and not ex:
        raise SystemExit("no results yet: run head_pose.py and/or expression.py first")
    hashes = {r["feature_code_hash"] for r in (hp, ex, tuned) if r}
    lines += [f"Feature code hash: {', '.join(sorted(hashes))}", ""]
    path = common.RESULTS / "report.md"
    path.write_text("\n".join(lines))
    print(f"wrote {path}")


if __name__ == "__main__":
    main()
