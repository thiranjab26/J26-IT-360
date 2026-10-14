"""Faithfulness gate: calibration on a labelled claim set, then an audit on real tutor output.

Three stages, run in order. Everything the gate uses (NLI wrapper, decomposers, the gate
itself) is imported from the service, so what is measured here is what runs in production.

    build      Make a labelled evaluation set from the course's own theory passages.
               For each passage a language model writes statements that are supported by
               it, that contradict it, and that it neither states nor implies. A second,
               independent call then judges every statement against the passage, and only
               items where the judge agrees with the construction are kept.
    calibrate  Score the set with an NLI model, report how well P(entailment) separates
               supported from unsupported claims, and choose the decision threshold on
               half of the concepts (dev) and report it on the other half (test).
    audit      Generate real tutor explanations, run the full gate on them, and report
               how many pass, how many claims are flagged, how long it takes, and write a
               sample for a person to label.

Run from the repository root:

    uv run --project backend/services/tutor-service \\
        python "research/c3-RAG tutor/experiments/gate_eval.py" build
    ... calibrate [--models MODEL ...]
    ... audit --threshold 0.30 [--limit 20]

LIMITS, stated up front because they decide what the numbers can support:
  * Labels are made by construction and then cleaned by a language-model judge, not by a
    person. They are a calibration aid. A person-labelled sample (the CSV that `audit`
    writes) is what validates them, and any accuracy claim in a report must come from that.
  * The statements are written by the same family of model that writes the tutor's text,
    so they are easier than adversarial errors. Treat recall figures as optimistic.
  * 13 concepts, one module. A threshold chosen here is for this course's style of text.
"""

# ruff: noqa

from __future__ import annotations

import argparse
import csv
import json
import os
import random
import re
import statistics
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import date
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[2]
SERVICE = REPO / "backend" / "services" / "tutor-service"
RESULTS = HERE.parent / "results"

os.chdir(SERVICE)
sys.path.insert(0, str(SERVICE))
os.environ.setdefault("HF_HUB_DISABLE_SYMLINKS_WARNING", "1")

from app.config import get_settings
from app.llm.providers import LLMError, build_provider
from app.sessions.catalog import load_course
from app.sessions.writer import EXPLAIN, TutorWriter
from app.verification.claims import LLMDecomposer, SentenceDecomposer
from app.verification.gate import CLAIM, WHOLE_RESPONSE, FaithfulnessGate
from app.verification.nli import DebertaNLI

DATASET = RESULTS / "gate-dataset.json"

GENERATE_SYSTEM = "You write test data for a fact-checking system. Output ONLY a JSON object, nothing else."
GENERATE_ASK = (
    "Using the passage, write three lists of statements, one sentence each, each making sense "
    "on its own. Return a JSON object with exactly these keys:\n"
    '- "supported": 6 statements the passage clearly supports, put in your own words (do not '
    "copy sentences from the passage)\n"
    '- "contradiction": 4 statements that sound plausible to a beginner but are FALSE according '
    "to the passage, because it says the opposite or something incompatible\n"
    '- "addition": 4 statements on the same topic that the passage does NOT state and does NOT '
    "imply, so a reader could not check them against the passage (they may be true in general)"
)
JUDGE_SYSTEM = (
    "You are a strict fact-checker. For each numbered statement decide, using ONLY the "
    "passage, one of: supported (the passage states or clearly implies it), contradicted "
    "(the passage says something incompatible), not_stated (the passage neither says nor "
    "implies it). Output ONLY a JSON array of strings, one per statement, in order."
)


def raw_provider():
    """The configured model without the production fallback chain. The chain's cool-down
    is right for serving students and wrong here: one rate-limit hiccup among several
    parallel calls would switch the model off for a minute for all of them."""
    chain = build_provider(get_settings())
    if chain is None:
        sys.exit("No language model is configured (set TUTOR_GEMINI_API_KEY).")
    return chain.providers[0] if hasattr(chain, "providers") else chain


def parse_array(text: str) -> list[str]:
    body = re.sub(r"^```(?:json)?\s*|\s*```$", "", text.strip())
    data = json.loads(body)
    if not isinstance(data, list) or not all(isinstance(x, str) for x in data):
        raise ValueError("not an array of strings")
    return [x.strip() for x in data if x.strip()]


_PACE = {"next": 0.0, "interval": 5.0}


def pace() -> None:
    """Keep calls at least `interval` seconds apart. The free tier rate-limits (HTTP 429)."""
    now = time.monotonic()
    wait = _PACE["next"] - now
    _PACE["next"] = max(now, _PACE["next"]) + _PACE["interval"]
    if wait > 0:
        time.sleep(wait)


def ask(provider, system: str, prompt: str, *, temperature: float, tries: int = 6) -> str:
    last: Exception | None = None
    for attempt in range(tries):
        pace()
        try:
            reply = provider.generate(system=system, prompt=prompt, max_tokens=1400, temperature=temperature)
            return reply.text
        except LLMError as exc:
            last = exc
            # A rate limit needs a real pause; other failures a short one.
            time.sleep(20 * (attempt + 1) if "429" in str(exc) else 2 * (attempt + 1))
    raise RuntimeError(f"model call failed after {tries} tries: {last}")


def passages_of(course) -> list[tuple[str, str, str]]:
    """(chunk_id, concept_id, text) for every theory passage."""
    return [(ref, cid, course.chunk_text[ref]) for cid in course.order for ref in course.theory[cid]]


# ------------------------------------------------------------------------- build
def build_for_passage(provider, ref: str, concept: str, passage: str) -> list[dict]:
    items: list[dict] = []
    for _ in range(3):
        reply = ask(provider, GENERATE_SYSTEM, f"Passage:\n<<<\n{passage}\n>>>\n\n{GENERATE_ASK}", temperature=0.7)
        try:
            data = json.loads(re.sub(r"^```(?:json)?\s*|\s*```$", "", reply.strip()))
            for construct in ("supported", "contradiction", "addition"):
                statements = [x.strip() for x in data[construct] if isinstance(x, str) and x.strip()]
                items.extend({"passage_id": ref, "concept_id": concept, "construct": construct, "text": t} for t in statements)
            break
        except (ValueError, KeyError, TypeError):
            items = []
    if not items:
        raise RuntimeError(f"{ref}: could not get a usable statement set")

    numbered = "\n".join(f"{i + 1}. {item['text']}" for i, item in enumerate(items))
    judged = ask(provider, JUDGE_SYSTEM, f"Passage:\n<<<\n{passage}\n>>>\n\nStatements:\n{numbered}", temperature=0.0)
    verdicts = parse_array(judged)
    if len(verdicts) != len(items):
        raise RuntimeError(f"{ref}: judge returned {len(verdicts)} verdicts for {len(items)} statements")

    for item, verdict in zip(items, verdicts, strict=True):
        verdict = verdict.lower().strip()
        item["judge"] = verdict
        truth_supported = verdict == "supported"
        constructed_supported = item["construct"] == "supported"
        item["kept"] = truth_supported == constructed_supported and verdict in {"supported", "contradicted", "not_stated"}
        # Unsupported items are typed by what the judge found, not by what was asked for.
        item["label"] = "supported" if truth_supported else ("contradiction" if verdict == "contradicted" else "addition")
    return items


def cmd_build(args: argparse.Namespace) -> None:
    provider = raw_provider()
    course = load_course(get_settings().content_root, "prog")
    passages = passages_of(course)
    if args.limit:
        passages = passages[: args.limit]

    RESULTS.mkdir(parents=True, exist_ok=True)
    done: dict[str, list[dict]] = {}
    if DATASET.exists():
        done = {k: v for k, v in json.loads(DATASET.read_text(encoding="utf-8"))["by_passage"].items()}
    todo = [p for p in passages if p[0] not in done]
    print(f"{len(passages)} passages, {len(done)} already built, {len(todo)} to do")

    skipped: list[str] = []

    def work(p):
        ref, concept, text = p
        try:
            return ref, build_for_passage(provider, ref, concept, text)
        except RuntimeError as exc:
            # One bad passage must not lose the rest; it is reported and can be rerun.
            print(f"  SKIPPED {ref}: {exc}")
            skipped.append(ref)
            return ref, None

    with ThreadPoolExecutor(max_workers=1) as pool:
        for count, (ref, items) in enumerate(pool.map(work, todo), 1):
            if items is None:
                continue
            done[ref] = items
            DATASET.write_text(json.dumps({"by_passage": done}, indent=1), encoding="utf-8")
            print(f"  [{count}/{len(todo)}] {ref}: {sum(i['kept'] for i in items)}/{len(items)} kept")

    if skipped:
        print(f"\n{len(skipped)} passages skipped; run `build` again to retry them: {skipped}")
    flat = [i for items in done.values() for i in items]
    kept = [i for i in flat if i["kept"]]
    print(f"\ngenerated {len(flat)}, kept {len(kept)} ({len(kept) / len(flat):.0%}) where the judge agreed")
    for label in ("supported", "contradiction", "addition"):
        print(f"  {label:14} {sum(i['label'] == label for i in kept)}")


# --------------------------------------------------------------------- calibrate
def load_items() -> list[dict]:
    data = json.loads(DATASET.read_text(encoding="utf-8"))["by_passage"]
    return [i for items in data.values() for i in items if i["kept"]]


def auroc(positive: list[float], negative: list[float]) -> float:
    """P(a supported claim scores higher than an unsupported one); ties count half."""
    if not positive or not negative:
        return float("nan")
    wins = sum((p > n) + 0.5 * (p == n) for p in positive for n in negative)
    return wins / (len(positive) * len(negative))


def score_items(items: list[dict], nli: DebertaNLI, passages: dict[str, str], windows: bool = False) -> list[dict]:
    suffix = "-windows" if windows else ""
    cache_path = RESULTS / f"gate-scores-{nli.name.replace('/', '__')}{suffix}.json"
    cache = json.loads(cache_path.read_text(encoding="utf-8")) if cache_path.exists() else {}
    todo = [i for i in items if i["text"] + "|" + i["passage_id"] not in cache]
    if todo:
        from app.verification.gate import score_against

        started = time.perf_counter()
        for n, item in enumerate(todo, 1):
            (s,) = score_against(nli, passages[item["passage_id"]], [item["text"]], windows)
            cache[item["text"] + "|" + item["passage_id"]] = [s.entailment, s.neutral, s.contradiction]
            if n % 200 == 0:
                cache_path.write_text(json.dumps(cache), encoding="utf-8")
                print(f"  {n}/{len(todo)} scored, {time.perf_counter() - started:.0f}s")
        cache_path.write_text(json.dumps(cache), encoding="utf-8")
        print(f"  scored {len(todo)} claims in {time.perf_counter() - started:.0f}s")
    out = []
    for item in items:
        e, n, c = cache[item["text"] + "|" + item["passage_id"]]
        out.append({**item, "p_ent": e, "p_neu": n, "p_con": c})
    return out


def rates(rows: list[dict], t: float) -> dict[str, float]:
    sup = [r for r in rows if r["label"] == "supported"]
    con = [r for r in rows if r["label"] == "contradiction"]
    add = [r for r in rows if r["label"] == "addition"]
    uns = con + add

    def block(group):
        return sum(r["p_ent"] < t for r in group) / len(group) if group else float("nan")

    return {
        "supported_pass": 1 - block(sup),
        "contradiction_block": block(con),
        "addition_block": block(add),
        "unsupported_block": block(uns),
    }


def cmd_calibrate(args: argparse.Namespace) -> None:
    course = load_course(get_settings().content_root, "prog")
    passages = {ref: text for ref, _, text in passages_of(course)}
    items = load_items()
    if args.subsample:
        # A fixed, label-balanced subset, so two methods can be compared on the same claims
        # when one of them is slow to run.
        rng = random.Random(3)
        picked = []
        for label in ("supported", "contradiction", "addition"):
            group = [i for i in items if i["label"] == label]
            rng.shuffle(group)
            picked += group[: args.subsample]
        items = picked
    # Split by concept, never by item, so near-duplicate statements about one passage
    # cannot sit on both sides of the split.
    dev_concepts = {c for i, c in enumerate(course.order) if i % 2 == 0}
    stamp = date.today().isoformat() + ("-windows" if args.windows else "") + (f"-sub{args.subsample}" if args.subsample else "") + (f"-block{round(args.target_block * 100)}" if args.target_block != 0.95 else "")
    lines = [f"# Gate calibration ({stamp})" + (", premise windows on" if args.windows else ""), ""]
    counts = {label: sum(i["label"] == label for i in items) for label in ("supported", "contradiction", "addition")}
    lines += [
        f"Labelled claims kept: {len(items)} ({counts}). Dev concepts: {len(dev_concepts)} of {len(course.order)}; the rest are the test split.",
        "Labels are by construction, cleaned by an independent model judge. See the script header for what that does and does not support.",
        "",
    ]

    for model_name in args.models:
        print(f"\n== {model_name}")
        nli = DebertaNLI(model_name)
        rows = score_items(items, nli, passages, args.windows)
        dev = [r for r in rows if r["concept_id"] in dev_concepts]
        test = [r for r in rows if r["concept_id"] not in dev_concepts]

        def split_auc(group):
            sup = [r["p_ent"] for r in group if r["label"] == "supported"]
            return (
                auroc(sup, [r["p_ent"] for r in group if r["label"] != "supported"]),
                auroc(sup, [r["p_ent"] for r in group if r["label"] == "contradiction"]),
                auroc(sup, [r["p_ent"] for r in group if r["label"] == "addition"]),
            )

        a_dev, a_test = split_auc(dev), split_auc(test)
        # Top-label baseline: "supported" only when the model's top label is entailment.
        argmax = {
            "supported_pass": statistics.mean(r["p_ent"] >= max(r["p_neu"], r["p_con"]) for r in test if r["label"] == "supported"),
            "unsupported_block": statistics.mean(r["p_ent"] < max(r["p_neu"], r["p_con"]) for r in test if r["label"] != "supported"),
        }

        grid = [round(i / 100, 2) for i in range(1, 100)]
        chosen = next((t for t in grid if rates(dev, t)["unsupported_block"] >= args.target_block), None)
        youden = max(grid, key=lambda t: rates(dev, t)["supported_pass"] + rates(dev, t)["unsupported_block"])

        lines += [f"## {model_name}", ""]
        lines += [
            "AUROC, P(a supported claim outscores an unsupported one):",
            "",
            "| split | vs all unsupported | vs contradictions | vs additions |",
            "|---|---|---|---|",
            f"| dev | {a_dev[0]:.3f} | {a_dev[1]:.3f} | {a_dev[2]:.3f} |",
            f"| test | {a_test[0]:.3f} | {a_test[1]:.3f} | {a_test[2]:.3f} |",
            "",
            f"Top-label (argmax) baseline on test: supported claims accepted {argmax['supported_pass']:.1%}, unsupported blocked {argmax['unsupported_block']:.1%}.",
            "",
            f"Threshold chosen on DEV as the lowest value that blocks at least {args.target_block:.0%} of unsupported claims: **{chosen}**. Youden-optimal on dev: {youden}.",
            "",
            "| threshold | split | supported pass | contradictions blocked | additions blocked | all unsupported blocked |",
            "|---|---|---|---|---|---|",
        ]
        for t in sorted({chosen, youden, 0.21, 0.5} - {None}):
            for name, group in (("dev", dev), ("test", test)):
                r = rates(group, t)
                lines.append(
                    f"| {t} | {name} | {r['supported_pass']:.1%} | {r['contradiction_block']:.1%} | {r['addition_block']:.1%} | {r['unsupported_block']:.1%} |"
                )
        if chosen is not None:
            keep = rates(test, chosen)["supported_pass"]
            lines += [
                "",
                f"What a per-claim pass rate of {keep:.1%} means for a whole response, which passes only if EVERY claim does:",
                "",
                "| claims in the response | chance it passes |",
                "|---|---|",
                *[f"| {n} | {keep ** n:.0%} |" for n in (3, 5, 8, 10)],
            ]
        lines.append("")
        print("\n".join(lines[-22:]))

    out = RESULTS / f"gate-calibration-{stamp}.md"
    out.write_text("\n".join(lines), encoding="utf-8")
    print(f"\nwrote {out}")


# -------------------------------------------------------------------------- audit
AUDIT_TEXTS = RESULTS / "gate-audit-texts.json"


class FixedClaims:
    """A decomposer that returns claims already written, so a rerun costs no model calls."""

    def __init__(self, claims: list[str]) -> None:
        self._claims = tuple(claims)

    def decompose(self, prose: str):
        from app.verification.claims import Decomposition

        return Decomposition(self._claims, "llm")


def generate_audit_texts(provider, passages) -> dict[str, dict]:
    """One real tutor explanation per passage, and its atomic claims. Cached on disk."""
    from app.verification.claims import split_parts

    cache = json.loads(AUDIT_TEXTS.read_text(encoding="utf-8")) if AUDIT_TEXTS.exists() else {}
    writer = TutorWriter(provider)  # no gate: the raw text, as the model wrote it
    decomposer = LLMDecomposer(provider)
    for n, (ref, concept, passage) in enumerate(passages, 1):
        if ref in cache:
            continue
        pace()
        made = writer.write(EXPLAIN, concept=concept, passage=passage).generated
        if made is None:
            print(f"  [{n}/{len(passages)}] {ref}: generation failed, skipped")
            continue
        pace()
        decomposition = decomposer.decompose(split_parts(made.text).prose)
        cache[ref] = {"text": made.text, "claims": list(decomposition.claims), "method": decomposition.method}
        AUDIT_TEXTS.write_text(json.dumps(cache, indent=1), encoding="utf-8")
        print(f"  [{n}/{len(passages)}] {ref}: {len(decomposition.claims)} claims ({decomposition.method})")
    return cache


def cmd_audit(args: argparse.Namespace) -> None:
    settings = get_settings()
    provider = raw_provider()
    course = load_course(settings.content_root, "prog")
    passages = passages_of(course)
    random.Random(7).shuffle(passages)
    passages = passages[: args.limit] if args.limit else passages
    texts = generate_audit_texts(provider, passages)
    by_ref = {ref: (concept, passage) for ref, concept, passage in passages}

    # Score everything once with a near-zero threshold, then apply each threshold to the
    # recorded probabilities. A response passes at t if every claim scored at least t and it
    # has no invented code, which is exactly what the gate does.
    nli = DebertaNLI(args.model)
    nli.load()
    configs = {
        "claims/llm": lambda ref: FaithfulnessGate(nli, threshold=0.01, decomposer=FixedClaims(texts[ref]["claims"]), granularity=CLAIM, windows=args.windows),
        "claims/sentences": lambda ref: FaithfulnessGate(nli, threshold=0.01, decomposer=SentenceDecomposer(), granularity=CLAIM, windows=args.windows),
        "whole_response": lambda ref: FaithfulnessGate(nli, threshold=0.01, granularity=WHOLE_RESPONSE, windows=args.windows),
    }
    results: dict[str, dict] = {}
    for ref, entry in texts.items():
        if ref not in by_ref:
            continue
        passage = by_ref[ref][1]
        results[ref] = {name: make(ref).check(entry["text"], passage) for name, make in configs.items()}

    def passes(result, t: float) -> bool:
        return all(v.p_entailment is not None and v.p_entailment >= t for v in result.verdicts)

    thresholds = sorted(args.thresholds)
    stamp = date.today().isoformat() + ("-windows" if args.windows else "")
    lines = [
        f"# Gate audit on real tutor explanations ({stamp})",
        "",
        f"{len(results)} explanations written by the tutor prompt (one per passage, random order), NLI model {nli.name}.",
        "Nothing here says the flagged claims are wrong: that needs a person (see the CSV).",
        "",
        "## Share of responses that pass the whole gate on the first try",
        "",
        "| configuration | " + " | ".join(f"t={t}" for t in thresholds) + " | mean claims | mean decompose ms | mean verify ms |",
        "|---|" + "---|" * (len(thresholds) + 3),
    ]
    for name in configs:
        rs = [results[ref][name] for ref in results]
        cells = [f"{sum(passes(r, t) for r in rs) / len(rs):.0%}" for t in thresholds]
        lines.append(
            f"| {name} | " + " | ".join(cells)
            + f" | {statistics.mean(len(r.verdicts) for r in rs):.1f} | {statistics.mean(r.decompose_ms for r in rs):.0f} | {statistics.mean(r.verify_ms for r in rs):.0f} |"
        )

    claims = [v for ref in results for v in results[ref]["claims/llm"].verdicts if v.p_entailment is not None]
    scores = sorted(v.p_entailment for v in claims)
    lines += [
        "",
        f"## Per-claim scores of the {len(claims)} atomic claims (claims/llm)",
        "",
        "| threshold | claims below it (would be flagged) |",
        "|---|---|",
        *[f"| {t} | {sum(s < t for s in scores)} ({sum(s < t for s in scores) / len(scores):.1%}) |" for t in thresholds],
        "",
        f"Median P(entailment) {statistics.median(scores):.3f}; 10th percentile {scores[len(scores) // 10]:.3f}; minimum {scores[0]:.3f}.",
        "",
        f"## Claims below {args.sample_threshold} (claims/llm)",
        "",
    ]
    for ref in results:
        for v in results[ref]["claims/llm"].verdicts:
            if v.p_entailment is not None and v.p_entailment < args.sample_threshold:
                lines.append(f"- `{ref}` ({v.p_entailment:.2f}, {v.label}): {v.text}")
    (RESULTS / f"gate-audit-{stamp}.md").write_text("\n".join(lines), encoding="utf-8")

    # A sample for a person to label, in shuffled order so the labeller cannot tell which
    # claims the gate flagged: every flagged claim up to half the sample, the rest passed.
    flagged, passed = [], []
    for ref in results:
        for v in results[ref]["claims/llm"].verdicts:
            if v.p_entailment is None:
                continue
            row = {
                "passage_id": ref,
                "claim": v.text,
                "passage": by_ref[ref][1],
                "gate": "flag" if v.p_entailment < args.sample_threshold else "pass",
                "p_entailment": f"{v.p_entailment:.3f}",
            }
            (flagged if row["gate"] == "flag" else passed).append(row)
    rng = random.Random(11)
    rng.shuffle(flagged)
    rng.shuffle(passed)
    k = min(len(flagged), args.sample // 2)
    sample = flagged[:k] + passed[: args.sample - k]
    rng.shuffle(sample)
    csv_path = RESULTS / f"gate-human-labels-{stamp}.csv"
    with csv_path.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=["id", "passage_id", "claim", "passage", "human_label", "gate", "p_entailment"])
        w.writeheader()
        for i, row in enumerate(sample, 1):
            w.writerow({"id": i, "human_label": "", **row})
    print("\n".join(lines[:22]))
    print(f"\nwrote {RESULTS / f'gate-audit-{stamp}.md'} and {csv_path} ({len(sample)} claims to label)")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    sub = parser.add_subparsers(dest="cmd", required=True)

    b = sub.add_parser("build")
    b.add_argument("--limit", type=int, default=0, help="only the first N passages")
    b.set_defaults(func=cmd_build)

    c = sub.add_parser("calibrate")
    c.add_argument("--models", nargs="+", default=["MoritzLaurer/DeBERTa-v3-base-mnli-fever-anli"])
    c.add_argument("--subsample", type=int, default=0, help="use N claims per label (same ones every run)")
    c.add_argument("--windows", action="store_true", help="also judge each claim against short stretches of the passage")
    c.add_argument("--target-block", type=float, default=0.95, help="share of unsupported claims the threshold must block on dev")
    c.set_defaults(func=cmd_calibrate)

    a = sub.add_parser("audit")
    a.add_argument("--thresholds", type=float, nargs="+", default=[0.21, 0.5, 0.65, 0.77, 0.9])
    a.add_argument("--sample-threshold", type=float, default=0.77, help="claims below this are 'flagged' in the CSV")
    a.add_argument("--no-windows", dest="windows", action="store_false", help="judge against the whole passage only")
    a.add_argument("--model", default="MoritzLaurer/DeBERTa-v3-base-mnli-fever-anli")
    a.add_argument("--limit", type=int, default=0)
    a.add_argument("--sample", type=int, default=60, help="claims in the CSV for a person to label")
    a.set_defaults(func=cmd_audit)

    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
