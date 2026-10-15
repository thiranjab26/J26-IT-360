"""Human labelling of tutor claims, blind to the gate, and the comparison afterwards.

The faithfulness gate has so far been measured on claims labelled by a language model. This is
the step that puts a person's judgement behind the numbers: someone reads a claim and the
course passage it was written from and says whether the passage supports it, WITHOUT seeing
what the gate decided. Seeing the gate's verdict would pull the labels towards it.

    make    Build the labelling page and the answer key from the sample that `gate_eval.py
            audit` wrote. The page contains only the claim and its passage.
    score   Read the labels you exported from the page and compare them with the gate.

Run from the repository root:

    uv run --project backend/services/tutor-service \\
        python "research/c3-RAG tutor/experiments/label_tool.py" make
    # open results/labelling/label-sheet.html in a browser, label, press Download labels
    uv run --project backend/services/tutor-service \\
        python "research/c3-RAG tutor/experiments/label_tool.py" score path/to/human-labels.csv

What the comparison can and cannot say. The sample is deliberately half claims the gate flagged
and half it passed, so each group can be judged separately. The population figures (how many
claims the gate flagged and passed in all) come from the audit, and are used to scale the two
groups back up to an estimate of the gate's recall and false-alarm rate. With 30 claims per group
the intervals are wide: this is a first human-checked estimate, not a final accuracy.
"""

from __future__ import annotations

import argparse
import csv
import json
import math
import re
from collections import Counter
from pathlib import Path

HERE = Path(__file__).resolve().parent
RESULTS = HERE.parent / "results"
OUT = RESULTS / "labelling"

LABELS = {"supported", "contradicted", "not_supported", "unsure"}
UNSUPPORTED = {"contradicted", "not_supported"}


# --------------------------------------------------------------------------------- make
def latest_sample() -> Path:
    files = sorted(RESULTS.glob("gate-human-labels-*windows.csv")) or sorted(
        RESULTS.glob("gate-human-labels-*.csv")
    )
    if not files:
        raise SystemExit("No sample found. Run gate_eval.py audit first.")
    return files[-1]


def population() -> dict[str, int]:
    """How many claims the audit examined and how many the gate flagged at its threshold."""
    audits = sorted(RESULTS.glob("gate-audit-*windows.md")) or sorted(RESULTS.glob("gate-audit-*.md"))
    text = audits[-1].read_text(encoding="utf-8") if audits else ""
    total = re.search(r"of the (\d+) atomic claims", text)
    flagged = re.search(r"\|\s*0\.77\s*\|\s*(\d+)\s*\(", text)
    if total and flagged:
        return {"total": int(total.group(1)), "flagged": int(flagged.group(1))}
    return {}


def cmd_make(_: argparse.Namespace) -> None:
    source = latest_sample()
    rows = list(csv.DictReader(source.open(encoding="utf-8")))
    OUT.mkdir(parents=True, exist_ok=True)

    items = [
        {"id": int(r["id"]), "passage_id": r["passage_id"], "claim": r["claim"], "passage": r["passage"]}
        for r in rows
    ]
    key = {
        "source": source.name,
        "population": population(),
        "gate": {r["id"]: {"decision": r["gate"], "p_entailment": float(r["p_entailment"])} for r in rows},
    }
    (OUT / "key.json").write_text(json.dumps(key, indent=1), encoding="utf-8")
    page = PAGE.replace("__ITEMS__", json.dumps(items).replace("</", "<\\/"))
    (OUT / "label-sheet.html").write_text(page, encoding="utf-8")
    print(f"{len(items)} claims from {source.name}")
    print(f"labelling page: {OUT / 'label-sheet.html'}  (open it in a browser)")
    print(f"answer key (do not open before labelling): {OUT / 'key.json'}")


# -------------------------------------------------------------------------------- score
def wilson(successes: int, n: int, z: float = 1.96) -> tuple[float, float]:
    """95% interval for a proportion that stays sensible for small samples."""
    if n == 0:
        return (float("nan"), float("nan"))
    p = successes / n
    denom = 1 + z * z / n
    centre = (p + z * z / (2 * n)) / denom
    half = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / denom
    return (max(0.0, centre - half), min(1.0, centre + half))


def pct(x: float) -> str:
    return "n/a" if math.isnan(x) else f"{x:.0%}"


def cmd_score(args: argparse.Namespace) -> None:
    key_path = Path(args.key) if args.key else OUT / "key.json"
    key = json.loads(key_path.read_text(encoding="utf-8"))
    with Path(args.labels).open(encoding="utf-8") as handle:
        given = {
            row["id"].strip(): row["human_label"].strip()
            for row in csv.DictReader(handle)
            if row.get("human_label", "").strip()
        }
    bad = {i: v for i, v in given.items() if v not in LABELS}
    if bad:
        raise SystemExit(f"Unknown labels: {bad}. Allowed: {sorted(LABELS)}")

    gate = key["gate"]
    judged = {i: v for i, v in given.items() if i in gate and v != "unsure"}
    print(f"{len(given)} labelled, {len(given) - len(judged)} unsure (left out), {len(judged)} used")
    print("labels:", dict(Counter(given.values())))

    flagged = [i for i in judged if gate[i]["decision"] == "flag"]
    passed = [i for i in judged if gate[i]["decision"] == "pass"]
    tp = sum(judged[i] in UNSUPPORTED for i in flagged)  # flagged and really unsupported
    fp = len(flagged) - tp  # flagged but the passage does support it: a false alarm
    fn = sum(judged[i] in UNSUPPORTED for i in passed)  # passed but really unsupported: a miss
    tn = len(passed) - fn

    print("\n                      human: unsupported   human: supported")
    print(f"gate flagged          {tp:>10}           {fp:>10}")
    print(f"gate passed           {fn:>10}           {tn:>10}")

    lo, hi = wilson(tp, len(flagged))
    print(f"\nOf the claims the gate FLAGGED, {pct(tp / len(flagged) if flagged else float('nan'))} "
          f"were truly unsupported (95% range {pct(lo)} to {pct(hi)}, n={len(flagged)}).")
    print(f"The other {fp} were false alarms: the passage does support them.")
    lo, hi = wilson(tn, len(passed))
    print(f"Of the claims the gate PASSED, {pct(tn / len(passed) if passed else float('nan'))} "
          f"were truly supported (95% range {pct(lo)} to {pct(hi)}, n={len(passed)}).")
    print(f"The other {fn} were unsupported claims that got through.")

    pop = key.get("population") or {}
    if pop and flagged and passed:
        n_flag, n_pass = pop["flagged"], pop["total"] - pop["flagged"]
        flagged_bad = (tp / len(flagged)) * n_flag
        passed_bad = (fn / len(passed)) * n_pass
        total_bad = flagged_bad + passed_bad
        flagged_good = n_flag - flagged_bad
        passed_good = n_pass - passed_bad
        print(f"\nScaled to all {pop['total']} claims the audit examined "
              f"({n_flag} flagged, {n_pass} passed), as a rough estimate:")
        if total_bad > 0:
            print(f"  share of truly unsupported claims the gate caught (recall): {flagged_bad / total_bad:.0%}")
        if flagged_good + passed_good > 0:
            print(f"  share of truly supported claims the gate wrongly flagged:    {flagged_good / (flagged_good + passed_good):.0%}")
        print("  (the two groups of 30 are small, so treat these as a first estimate)")

    by_label = Counter(judged[i] for i in flagged)
    if flagged:
        print("\nWhat the flagged claims turned out to be:", dict(by_label))


# --------------------------------------------------------------------------------- page
PAGE = """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Claim labelling</title>
<style>
  :root { --bg:#f4f5f8; --card:#fff; --ink:#1f2330; --muted:#666c80; --line:#dfe2ea; --brand:#4a5fc1;
          --ok:#2f8f5f; --bad:#c0392b; --warn:#b7791f; --soft:#eef0fa; }
  @media (prefers-color-scheme: dark) {
    :root { --bg:#14161d; --card:#1d2029; --ink:#e8eaf2; --muted:#9aa1b5; --line:#2e3240; --brand:#8fa0ff;
            --ok:#5fcf9a; --bad:#ff7b6b; --warn:#e8b45a; --soft:#252a3d; }
  }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--bg); color:var(--ink); font:15px/1.55 system-ui, sans-serif; }
  main { max-width:880px; margin:0 auto; padding:20px 16px 60px; }
  h1 { font-size:20px; margin:0 0 4px; }
  .muted { color:var(--muted); font-size:13px; }
  .bar { height:8px; background:var(--line); border-radius:99px; overflow:hidden; margin:10px 0 4px; }
  .bar > div { height:100%; background:var(--brand); width:0; transition:width .3s; }
  details { background:var(--card); border:1px solid var(--line); border-radius:12px; padding:12px 16px; margin:14px 0; }
  summary { cursor:pointer; font-weight:600; }
  details dl { margin:10px 0 0; } details dt { font-weight:600; margin-top:8px; }
  details dd { margin:2px 0 0 0; color:var(--muted); }
  .card { background:var(--card); border:1px solid var(--line); border-radius:14px; padding:20px; margin-top:14px; }
  .label { font:600 11px/1 ui-monospace, monospace; letter-spacing:.08em; text-transform:uppercase; color:var(--muted); }
  .claim { font-size:19px; font-weight:600; margin:8px 0 18px; padding:14px 16px; background:var(--soft);
           border-left:4px solid var(--brand); border-radius:8px; }
  .passage { white-space:pre-wrap; background:var(--bg); border:1px solid var(--line); border-radius:10px;
             padding:14px 16px; margin-top:8px; max-height:340px; overflow:auto; font-size:14px; }
  .buttons { display:grid; grid-template-columns:repeat(auto-fit,minmax(170px,1fr)); gap:10px; margin-top:18px; }
  button { font:inherit; border:1px solid var(--line); background:var(--card); color:var(--ink); border-radius:10px;
           padding:11px 12px; cursor:pointer; text-align:left; }
  button:hover { border-color:var(--brand); }
  button kbd { float:right; font:11px ui-monospace, monospace; color:var(--muted); border:1px solid var(--line);
               border-radius:5px; padding:0 5px; }
  button.on { border-width:2px; border-color:var(--brand); background:var(--soft); font-weight:600; }
  .nav { display:flex; justify-content:space-between; align-items:center; gap:10px; margin-top:16px; flex-wrap:wrap; }
  .nav button { text-align:center; padding:8px 14px; }
  .primary { background:var(--brand); color:#fff; border-color:var(--brand); }
  .dots { display:flex; flex-wrap:wrap; gap:4px; margin-top:14px; }
  .dots i { width:14px; height:14px; border-radius:4px; background:var(--line); cursor:pointer; }
  .dots i.done { background:var(--ok); } .dots i.unsure { background:var(--warn); } .dots i.here { outline:2px solid var(--brand); }
</style>
</head>
<body>
<main>
  <h1>Does the passage support the claim?</h1>
  <p class="muted">Judge each claim against the passage shown, and only that passage. You will not see what the
  checker decided. Your answers are saved in this browser as you go.</p>

  <details open>
    <summary>How to decide (read once)</summary>
    <dl>
      <dt>Supported</dt>
      <dd>The passage says it, or it clearly follows from what the passage says. Different wording is fine.</dd>
      <dt>Contradicted</dt>
      <dd>The passage says something that cannot be true if the claim is true.</dd>
      <dt>Not supported</dt>
      <dd>The passage neither says it nor clearly implies it. This includes things that are true about Java in
      general but are not in the passage. If the passage does not say it, it is not supported.</dd>
      <dt>Unsure</dt>
      <dd>You cannot decide even after reading the passage again. Use sparingly.</dd>
    </dl>
    <p class="muted"><b>Rules.</b> Use only the passage, not what you know. A claim that mixes a supported part and
    an unsupported part is Not supported. Ignore spelling and style. Do not try to guess what a checker would say.</p>
    <p class="muted"><b>Examples.</b> Passage: "The condition is checked before every iteration." Claim: "A while loop
    can run zero times." is Supported (it follows). "A while loop always runs at least once." is Contradicted.
    "A while loop is the fastest loop in Java." is Not supported (the passage never says it).</p>
  </details>

  <div class="bar"><div id="bar"></div></div>
  <div class="muted" id="count"></div>

  <section class="card">
    <div class="label">Claim <span id="pos"></span></div>
    <div class="claim" id="claim"></div>
    <div class="label">Course passage</div>
    <div class="passage" id="passage"></div>
    <div class="buttons" id="buttons"></div>
    <div class="nav">
      <button id="prev">Previous</button>
      <span class="muted">keys: S, C, N, U to label, left and right arrows to move</span>
      <button id="next">Next</button>
    </div>
    <div class="dots" id="dots"></div>
  </section>

  <div class="nav" style="margin-top:20px">
    <span class="muted">You can download at any point, even part way through.</span>
    <button class="primary" id="download">Download labels</button>
  </div>
</main>

<script>
const ITEMS = __ITEMS__;
const CHOICES = [
  ["supported", "Supported", "S"], ["contradicted", "Contradicted", "C"],
  ["not_supported", "Not supported", "N"], ["unsure", "Unsure", "U"],
];
const STORE = "claim-labels-v1";
let labels = {};
try { labels = JSON.parse(localStorage.getItem(STORE) || "{}"); } catch (e) { labels = {}; }
let at = 0;
const first = ITEMS.findIndex(i => !labels[i.id]);
if (first > 0) at = first;
const $ = id => document.getElementById(id);

function save() { try { localStorage.setItem(STORE, JSON.stringify(labels)); } catch (e) {} }
function done() { return ITEMS.filter(i => labels[i.id]).length; }

function render() {
  const item = ITEMS[at];
  $("claim").textContent = item.claim;
  $("passage").textContent = item.passage;
  $("pos").textContent = "(" + (at + 1) + " of " + ITEMS.length + ")";
  $("count").textContent = done() + " of " + ITEMS.length + " labelled";
  $("bar").style.width = (100 * done() / ITEMS.length) + "%";
  $("buttons").innerHTML = "";
  CHOICES.forEach(([value, text, key]) => {
    const b = document.createElement("button");
    b.innerHTML = text + "<kbd>" + key + "</kbd>";
    if (labels[item.id] === value) b.className = "on";
    b.onclick = () => choose(value);
    $("buttons").appendChild(b);
  });
  $("dots").innerHTML = "";
  ITEMS.forEach((it, i) => {
    const d = document.createElement("i");
    d.className = (labels[it.id] === "unsure" ? "unsure" : labels[it.id] ? "done" : "") + (i === at ? " here" : "");
    d.title = "claim " + (i + 1);
    d.onclick = () => { at = i; render(); };
    $("dots").appendChild(d);
  });
  $("passage").scrollTop = 0;
}
function choose(value) {
  labels[ITEMS[at].id] = value; save();
  if (at < ITEMS.length - 1) at += 1;
  render();
}
function move(step) { at = Math.min(ITEMS.length - 1, Math.max(0, at + step)); render(); }
$("prev").onclick = () => move(-1);
$("next").onclick = () => move(1);
document.addEventListener("keydown", e => {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const k = e.key.toLowerCase();
  const hit = CHOICES.find(c => c[2].toLowerCase() === k);
  if (hit) choose(hit[0]);
  else if (e.key === "ArrowRight") move(1);
  else if (e.key === "ArrowLeft") move(-1);
});
$("download").onclick = () => {
  const rows = ["id,human_label"].concat(ITEMS.filter(i => labels[i.id]).map(i => i.id + "," + labels[i.id]));
  const blob = new Blob([rows.join("\\n") + "\\n"], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = "human-labels.csv"; a.click();
};
render();
</script>
</body>
</html>
"""


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    sub = parser.add_subparsers(dest="cmd", required=True)
    sub.add_parser("make").set_defaults(func=cmd_make)
    score = sub.add_parser("score")
    score.add_argument("labels", help="the human-labels.csv downloaded from the page")
    score.add_argument("--key", help="answer key (default: the one `make` wrote)")
    score.set_defaults(func=cmd_score)
    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
