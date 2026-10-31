"""Pilot-study session loader (TODO C1): exports -> 30 s windows [T, F].

Input: the per-session files written by the TypeScript tool

    pnpm session-to-features <c2-study-P0x-....json>... --out=<dir>

(<name>.z.npy, .raw.npy, .seconds.csv, .meta.json). The per-second features
are computed there by the app's own FeaturePipeline; Python never computes a
feature (CLAUDE.md "one source of truth").

Windows follow feature_spec.json exactly as the browser builds them:
`window_seconds` consecutive seconds, invalid seconds set to 0 after
z-scoring, and a window is usable only if at most `max_invalid_fraction` of
its seconds are invalid. A window is kept only if every one of its seconds
lies inside one block (no window spans a block change or the questionnaire
gap), so its block is unambiguous.

Labels are NOT chosen here. The label definition is still open (TODO A0,
ARCHITECTURE.md §12: designed difficulty vs. per-participant NASA-TLX
terciles), so every window carries its block kind, block index and that
block's NASA-TLX answers, and the training script maps them to a label.

    python sessions.py <dir>        # summary of what the windows would be
"""

from __future__ import annotations

import csv
import json
import sys
from dataclasses import dataclass
from pathlib import Path

import numpy as np

SPEC_PATH = (
    Path(__file__).resolve().parents[3]
    / "packages"
    / "load-sensor"
    / "public"
    / "models"
    / "classifier"
    / "feature_spec.json"
)


def load_spec(path: Path = SPEC_PATH) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


@dataclass(frozen=True)
class Session:
    name: str
    participant: str
    z: np.ndarray  # [S, F] float32, NaN while calibrating
    raw: np.ndarray  # [S, F] float32
    block: np.ndarray  # [S] int, -1 between blocks
    kind: np.ndarray  # [S] str ('' between blocks)
    pure: np.ndarray  # [S] bool: all the second's frames in one block
    valid: np.ndarray  # [S] bool
    meta: dict


def load_session(directory: Path, name: str, spec: dict | None = None) -> Session:
    spec = spec or load_spec()
    meta = json.loads((directory / f"{name}.meta.json").read_text(encoding="utf-8"))
    names = [f["name"] for f in spec["features"]]
    if meta["features"] != names:
        raise ValueError(f"{name}: feature columns differ from feature_spec.json; re-run session-to-features")
    if meta["replayed_code_hash"] != spec["code_hash"]:
        raise ValueError(f"{name}: replayed with other feature code; re-run session-to-features")
    z = np.load(directory / f"{name}.z.npy")
    raw = np.load(directory / f"{name}.raw.npy")
    with open(directory / f"{name}.seconds.csv", newline="", encoding="utf-8") as f:
        rows = list(csv.DictReader(f))
    if not (len(rows) == z.shape[0] == raw.shape[0] == meta["seconds"]):
        raise ValueError(f"{name}: files disagree on the number of seconds")
    return Session(
        name=name,
        participant=meta["participant"],
        z=z,
        raw=raw,
        block=np.array([int(r["block"]) for r in rows], dtype=np.int64),
        kind=np.array([r["kind"] for r in rows]),
        pure=np.array([r["pure"] == "1" for r in rows]),
        valid=np.array([r["valid"] == "1" for r in rows]),
        meta=meta,
    )


def load_sessions(directory: Path, spec: dict | None = None) -> list[Session]:
    spec = spec or load_spec()
    names = sorted(p.name[: -len(".meta.json")] for p in directory.glob("*.meta.json"))
    return [load_session(directory, n, spec) for n in names]


@dataclass(frozen=True)
class Windows:
    x: np.ndarray  # [N, T, F] float32 z-scores, invalid seconds = 0
    mask: np.ndarray  # [N, T] uint8, 1 = valid second
    participant: np.ndarray  # [N] str, the LOSO group
    kind: np.ndarray  # [N] str: rest / easy / medium / hard / underload
    block: np.ndarray  # [N] int, block index within the session
    raw_tlx: np.ndarray  # [N] float, NaN for rest (no questionnaire)
    end_second: np.ndarray  # [N] int, last second of the window


def make_windows(session: Session, spec: dict | None = None, stride: int = 1) -> Windows:
    """Every usable window of one session, ending at each `stride`-th second.

    stride 1 matches the browser, which classifies once per second. Windows
    1 s apart overlap by 29 s, so they are not independent samples: evaluate
    leave-one-participant-out (`loso_folds`) and never split a participant's
    windows between train and test.
    """
    spec = spec or load_spec()
    t = int(spec["window_seconds"])
    max_invalid = float(spec["validity"]["max_invalid_fraction"])
    tlx_by_block = {b["index"]: b["raw_tlx"] for b in session.meta["blocks"]}

    # Seconds the browser would put in the window: after calibration (z set).
    ready = ~np.isnan(session.z).any(axis=1)
    xs, masks, kinds, blocks, tlx, ends = [], [], [], [], [], []
    for end in range(t - 1, len(session.z), stride):
        sl = slice(end - t + 1, end + 1)
        b = session.block[sl]
        if b[0] < 0 or not (b == b[0]).all() or not session.pure[sl].all() or not ready[sl].all():
            continue
        valid = session.valid[sl]
        if 1.0 - valid.mean() > max_invalid:
            continue
        x = np.where(valid[:, None], session.z[sl], 0.0).astype(np.float32)
        xs.append(x)
        masks.append(valid.astype(np.uint8))
        kinds.append(session.kind[end])
        blocks.append(int(b[0]))
        raw = tlx_by_block.get(int(b[0]))
        tlx.append(np.nan if raw is None else float(raw))
        ends.append(end)
    n = len(xs)
    f = int(spec["feature_count"])
    return Windows(
        x=np.stack(xs) if n else np.zeros((0, t, f), np.float32),
        mask=np.stack(masks) if n else np.zeros((0, t), np.uint8),
        participant=np.array([session.participant] * n),
        kind=np.array(kinds),
        block=np.array(blocks, dtype=np.int64),
        raw_tlx=np.array(tlx, dtype=np.float64),
        end_second=np.array(ends, dtype=np.int64),
    )


def concat(windows: list[Windows]) -> Windows:
    return Windows(*(np.concatenate([getattr(w, k) for w in windows]) for k in Windows.__dataclass_fields__))


def feature_columns(spec: dict, use_expression_features: bool = True) -> list[int]:
    """Column indices for the FR3 ablation: without expression, drop the ablatable features."""
    return [f["index"] for f in spec["features"] if use_expression_features or not f["ablatable"]]


def loso_folds(participant: np.ndarray) -> list[tuple[str, np.ndarray, np.ndarray]]:
    """Leave-one-subject-out (ARCHITECTURE.md §12): (held-out participant, train idx, test idx)."""
    return [
        (p, np.flatnonzero(participant != p), np.flatnonzero(participant == p))
        for p in sorted(set(participant.tolist()))
    ]


def main(argv: list[str]) -> None:
    if len(argv) != 1:
        raise SystemExit("usage: python sessions.py <session-features dir>")
    spec = load_spec()
    sessions = load_sessions(Path(argv[0]), spec)
    all_w = concat([make_windows(s, spec) for s in sessions]) if sessions else None
    for s in sessions:
        w = make_windows(s, spec)
        counts = {k: int((w.kind == k).sum()) for k in sorted(set(w.kind.tolist()))}
        print(f"{s.name}: {s.participant}, {len(s.z)} s, windows by block kind {counts}")
    if all_w is not None:
        print(f"total windows {len(all_w.x)}, shape {all_w.x.shape}, participants {sorted(set(all_w.participant))}")


if __name__ == "__main__":
    main(sys.argv[1:])
