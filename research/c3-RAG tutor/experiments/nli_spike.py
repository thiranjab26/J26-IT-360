"""NLI feasibility spike (C3, before building the faithfulness gate).

Two questions, answered on the machine the gate will run on:

  1. How fast is checking one claim against a course passage on a CPU?
  2. Does an off-the-shelf NLI model give sensible verdicts on course claims, and what
     decision rule should the gate use?

This is a PROBE, not the evaluation. It uses 10 claims I labelled by hand against
passages from one concept, so it can rule things out and point at a direction, but it
cannot support a reported accuracy. The real comparison runs on the labelled evaluation
set (phase P6).

Run from the repository root; the extra packages are only needed for this script:

    uv run --project backend/services/tutor-service --with sentencepiece --with protobuf \
        python "research/c3-RAG tutor/experiments/nli_spike.py" \
        MoritzLaurer/DeBERTa-v3-base-mnli-fever-anli cross-encoder/nli-deberta-v3-base
"""

# ruff: noqa: E501, E402, B023, I001  (probe script: long report lines, closures that run at once)
import os
import statistics
import sys
import time

os.environ.setdefault("HF_HUB_DISABLE_SYMLINKS_WARNING", "1")

import torch
from transformers import AutoModelForSequenceClassification, AutoTokenizer

MODELS = sys.argv[1:] or ["cross-encoder/nli-deberta-v3-small", "cross-encoder/nli-deberta-v3-base"]

# (premise, claim, what a correct verifier should say)
CASES = [
    (
        "The condition is checked before every iteration, including the first. If it is false at "
        "the start, the body runs zero times.",
        "A while loop can run zero times.",
        "entailment",
    ),
    (
        "The condition is checked before every iteration, including the first. If it is false at "
        "the start, the body runs zero times.",
        "A while loop always runs at least once.",
        "contradiction",
    ),
    (
        "The condition is checked before every iteration, including the first. If it is false at "
        "the start, the body runs zero times.",
        "A while loop is the fastest kind of loop in Java.",
        "neutral",
    ),
    (
        "The body runs first and the condition is checked afterwards, so the body always runs at "
        "least once.",
        "A do-while loop always runs its body at least once.",
        "entailment",
    ),
    (
        "The body runs first and the condition is checked afterwards, so the body always runs at "
        "least once.",
        "A do-while loop checks its condition before the first iteration.",
        "contradiction",
    ),
    (
        "A variable declared in the initialisation, such as i, exists only inside the loop. Using "
        "i after the loop ends is a compile-time error.",
        "Using the loop variable after a for loop has ended causes a compile error.",
        "entailment",
    ),
    (
        "A variable declared in the initialisation, such as i, exists only inside the loop. Using "
        "i after the loop ends is a compile-time error.",
        "A variable declared in a for loop header can be used freely after the loop.",
        "contradiction",
    ),
    (
        "A variable declared in the initialisation, such as i, exists only inside the loop. Using "
        "i after the loop ends is a compile-time error.",
        "A for loop can always be rewritten as a recursive method.",
        "neutral",
    ),
    (
        "for (int i = 0; i <= n; i++) runs n + 1 times, with i taking values 0 to n.",
        "A loop that counts from 0 up to and including n runs n plus one times.",
        "entailment",
    ),
    (
        "for (int i = 0; i <= n; i++) runs n + 1 times, with i taking values 0 to n.",
        "for (int i = 0; i <= n; i++) runs exactly n times.",
        "contradiction",
    ),
]

FILLER = (
    "Most loops follow one of a few patterns. A counting loop repeats a fixed number of "
    "times. An accumulator builds up a result across iterations, starting from the identity "
    "value: 0 for a sum, 1 for a product. A counter counts how many iterations satisfy a "
    "condition. A sentinel loop keeps reading input until a special stop value appears, and "
    "because the number of iterations is not known in advance a while loop is used. Digit "
    "processing repeatedly takes n % 10 and does n = n / 10 until n is 0. "
)


def normalise(label: str) -> str:
    label = label.lower()
    for key in ("entail", "contradict", "neutral"):
        if key in label:
            return {"entail": "entailment", "contradict": "contradiction", "neutral": "neutral"}[
                key
            ]
    return label


for name in MODELS:
    print(f"\n=== {name}")
    t = time.perf_counter()
    tok = AutoTokenizer.from_pretrained(name)
    model = AutoModelForSequenceClassification.from_pretrained(name).eval()
    print("weights loaded as", next(model.parameters()).dtype)
    model = model.float()  # CPU maths in half precision is very slow, so be explicit

    print(
        f"loaded in {time.perf_counter() - t:.1f}s | {sum(p.numel() for p in model.parameters()) / 1e6:.0f}M params"
        f" | threads={torch.get_num_threads()}"
    )
    labels = [normalise(model.config.id2label[i]) for i in range(model.config.num_labels)]

    def verdicts(pairs):
        enc = tok(
            [p for p, _ in pairs],
            [c for _, c in pairs],
            padding=True,
            truncation=True,
            max_length=512,
            return_tensors="pt",
        )
        with torch.no_grad():
            probs = torch.softmax(model(**enc).logits, dim=-1)
        verdicts.last_probs = [{labels[i]: float(r[i]) for i in range(len(labels))} for r in probs]
        return [(labels[int(r.argmax())], float(r.max())) for r in probs]

    out = verdicts([(p, c) for p, c, _ in CASES])
    probs = verdicts.last_probs
    right = sum(got == want for (got, _), (_, _, want) in zip(out, CASES, strict=True))
    print(f"sanity on {len(CASES)} hand-labelled course claims: {right}/{len(CASES)} correct")
    for (got, conf), (_, claim, want) in zip(out, CASES, strict=True):
        flag = "ok " if got == want else "BAD"
        print(f"   {flag} want {want:<13} got {got:<13} ({conf:.2f})  {claim[:58]}")

    # The gate needs a yes/no: is the claim supported? Neutral and contradiction both mean no.
    ent = [pr.get("entailment", 0.0) for pr in probs]
    want = [w == "entailment" for _, _, w in CASES]
    best = max(
        (sum((e >= t) == w for e, w in zip(ent, want, strict=True)), t)
        for t in [i / 100 for i in range(1, 100)]
    )
    argmax_ok = sum((g == "entailment") == w for (g, _), w in zip(out, want, strict=True))
    sup = [e for e, w in zip(ent, want, strict=True) if w]
    uns = [e for e, w in zip(ent, want, strict=True) if not w]
    print(
        f"supported-or-not at argmax: {argmax_ok}/{len(CASES)}; best single threshold on P(entailment): "
        f"{best[0]}/{len(CASES)} at {best[1]:.2f}"
    )
    print(f"   P(entailment) for supported claims: {', '.join(f'{e:.2f}' for e in sup)}")
    print(f"   P(entailment) for unsupported ones: {', '.join(f'{e:.2f}' for e in uns)}")

    # latency: one claim against a premise of growing length, one pair at a time
    print("latency per claim (one pair), median of 15:")
    for repeat in (1, 3, 6):
        premise = CASES[0][0] + " " + FILLER * repeat
        n_tok = len(tok(premise, CASES[0][1])["input_ids"])
        verdicts([(premise, CASES[0][1])])  # warm up
        times = []
        for _ in range(15):
            s = time.perf_counter()
            verdicts([(premise, CASES[0][1])])
            times.append((time.perf_counter() - s) * 1000)
        print(f"   ~{n_tok:>3} tokens: {statistics.median(times):6.0f} ms  (max {max(times):.0f})")

    # a realistic verification: 8 claims, each against one premise window of ~120 tokens
    pairs = [(CASES[i % len(CASES)][0] + " " + FILLER, CASES[i % len(CASES)][1]) for i in range(8)]
    verdicts(pairs)
    s = time.perf_counter()
    verdicts(pairs)
    batch = (time.perf_counter() - s) * 1000
    print(f"8 claims in one batch: {batch:.0f} ms total, {batch / 8:.0f} ms per claim")
