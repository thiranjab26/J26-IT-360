"""TODO P8.4: boredom, engagement, confusion and frustration from DAiSEE.

Inputs (written by the TypeScript tools; Python computes no feature):
  research/c2-load/video-extract  -> <dir>/daisee.csv (+ per-clip landmarks)
  pnpm daisee-to-features         -> <dir>/daisee.seconds.npy [N, 10, F] raw per-second
                                     features, daisee.valid.npy [N, 10], daisee.features.json
Labels come from DAiSEE's official {Train,Validation,Test}Labels.csv.

Protocol: train on Train, choose on Validation (macro-F1), test once on Test.
The splits are person-disjoint (70 / 22 / 21 people, checked 30 Oct 2026).

Labels grouped as decided by the owner (TODO P8 decision 2, 30 Oct 2026):
  boredom      0 / 1 / 2-3  -> not_bored / possibly_bored / bored (the app's states)
  engagement   0-1 / 2 / 3  -> low / medium / high
  confusion    0 / 1-3      -> absent / present
  frustration  0 / 1-3      -> absent / present

Models per state, all on the same rows:
  majority  always the most common training class (the floor to beat)
  forest    random forest on clip summaries (per-feature mean and std over the
            seconds with a face, plus the share of seconds with a face)
  gru       small GRU over the 10 per-second vectors (standardised with
            training-set mean/std, which ship with the model) + validity channel

The app's boredom rule cannot be run on 10 s clips (it needs 60 s / 5 min
windows and a 30 s calibration), so it is not scored here; see TODO P8.

  TF_USE_LEGACY_KERAS=1 python daisee.py            # writes results/daisee.json
  TF_USE_LEGACY_KERAS=1 python daisee.py --dry-run  # code check: validation only, nothing written
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import time

os.environ.setdefault("TF_USE_LEGACY_KERAS", "1")

import numpy as np

import common

DAISEE = common.DATASETS / "daisee" / "DAiSEE"
DIR = common.LANDMARKS / "daisee"
SPLITS = ("Train", "Validation", "Test")

GROUPS = {
    "boredom": ("Boredom", ("not_bored", "possibly_bored", "bored"), {0: 0, 1: 1, 2: 2, 3: 2}),
    "engagement": ("Engagement", ("low", "medium", "high"), {0: 0, 1: 0, 2: 1, 3: 2}),
    "confusion": ("Confusion", ("absent", "present"), {0: 0, 1: 1, 2: 1, 3: 1}),
    "frustration": ("Frustration", ("absent", "present"), {0: 0, 1: 1, 2: 1, 3: 1}),
}


def load() -> dict:
    meta = json.loads((DIR / "daisee.features.json").read_text())
    with open(DIR / "daisee.csv", newline="") as f:
        rows = list(csv.DictReader(f))
    seconds = np.load(DIR / "daisee.seconds.npy")
    valid = np.load(DIR / "daisee.valid.npy")
    if not (len(rows) == seconds.shape[0] == valid.shape[0] == meta["rows"]):
        raise ValueError("daisee.csv, seconds and valid disagree on the number of clips")
    labels: dict[str, dict[str, int]] = {}
    for split in SPLITS:
        with open(DAISEE / "Labels" / f"{split}Labels.csv", newline="") as f:
            for r in csv.DictReader(f):
                r = {k.strip(): v.strip() for k, v in r.items()}
                labels[os.path.splitext(r["ClipID"])[0]] = {k: int(v) for k, v in r.items() if k != "ClipID"}
    missing = [r["id"] for r in rows if r["id"] not in labels]
    if missing:
        raise ValueError(f"{len(missing)} extracted clips have no label, e.g. {missing[:3]}")
    return {
        "ids": [r["id"] for r in rows],
        "split": np.array([r["split"] for r in rows]),
        "subject": np.array([r["subject"] for r in rows]),
        "seconds": seconds,
        "valid": valid,
        "labels": labels,
        "feature_names": meta["features"],
        "feature_code_hash": meta["feature_code_hash"],
    }


def targets(data: dict, state: str) -> np.ndarray:
    column, _, mapping = GROUPS[state]
    return np.array([mapping[data["labels"][i][column]] for i in data["ids"]])


def summaries(seconds: np.ndarray, valid: np.ndarray) -> np.ndarray:
    """Per clip: mean and std of each feature over the seconds with a face, plus the share of such seconds."""
    face = valid > 0
    x = np.where(face[..., None], seconds, np.nan)
    with np.errstate(all="ignore"):
        mean = np.nanmean(x, axis=1)
        std = np.nanstd(x, axis=1)
    out = np.concatenate([mean, std, valid.mean(axis=1, keepdims=True)], axis=1)
    return np.nan_to_num(out, nan=0.0)


def sequences(seconds: np.ndarray, valid: np.ndarray, mean: np.ndarray, std: np.ndarray) -> np.ndarray:
    """Standardised per-second vectors (0 where no face) with the validity share as one more channel."""
    z = (seconds - mean) / std
    z = np.where(np.isfinite(z) & (valid[..., None] > 0), z, 0.0)
    return np.concatenate([z, valid[..., None]], axis=2).astype(np.float32)


def scores(pred: np.ndarray, truth: np.ndarray, classes: tuple[str, ...]) -> dict:
    from sklearn.metrics import accuracy_score, confusion_matrix, f1_score

    labels = list(range(len(classes)))
    return {
        "n": int(len(truth)),
        "accuracy": float(accuracy_score(truth, pred)),
        "macro_f1": float(f1_score(truth, pred, average="macro", labels=labels, zero_division=0)),
        "confusion": confusion_matrix(truth, pred, labels=labels).tolist(),
    }


def build_gru(steps: int, channels: int, classes: int):
    import tf_keras as keras

    return keras.Sequential([
        keras.layers.Input((steps, channels)),
        keras.layers.GRU(32),
        keras.layers.Dropout(0.3),
        keras.layers.Dense(classes, activation="softmax"),
    ])


def train_gru(x_tr, y_tr, x_va, y_va, classes: int, epochs: int):
    import tf_keras as keras
    from sklearn.utils.class_weight import compute_class_weight

    common.set_seed()
    present = np.unique(y_tr)
    w = compute_class_weight("balanced", classes=present, y=y_tr)
    model = build_gru(x_tr.shape[1], x_tr.shape[2], classes)
    model.compile(optimizer=keras.optimizers.Adam(1e-3), loss="sparse_categorical_crossentropy")
    stop = keras.callbacks.EarlyStopping(monitor="val_loss", patience=8, restore_best_weights=True)
    hist = model.fit(x_tr, y_tr, validation_data=(x_va, y_va), epochs=epochs, batch_size=64,
                     class_weight=dict(zip(present.tolist(), w.tolist())), callbacks=[stop], verbose=0)
    return model, {"epochs_run": len(hist.history["loss"]), "best_val_loss": float(min(hist.history["val_loss"]))}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true",
                        help="code check on whatever clips exist; Train people split into train/val; no test, nothing written")
    parser.add_argument("--epochs", type=int, default=200)
    args = parser.parse_args()
    started = time.time()
    common.set_seed()
    from sklearn.ensemble import RandomForestClassifier

    data = load()
    split = data["split"]
    if args.dry_run:
        # The few clips of a speed test are all Train: split them by person so validation stays unseen.
        people = np.unique(data["subject"][split == "Train"])
        if len(people) >= 2:
            val_people = list(people[: max(1, len(people) // 3)])
            tr = np.flatnonzero((split == "Train") & ~np.isin(data["subject"], val_people))
            va = np.flatnonzero((split == "Train") & np.isin(data["subject"], val_people))
        else:
            # One person only: halves of their clips. Code check only, never a result.
            rows = np.flatnonzero(split == "Train")
            tr, va = rows[: len(rows) // 2], rows[len(rows) // 2:]
        te = np.array([], dtype=int)
        args.epochs = min(args.epochs, 3)
    else:
        tr, va, te = (np.flatnonzero(split == s) for s in SPLITS)

    seconds, valid = data["seconds"], data["valid"]
    face_tr = np.where(valid[tr][..., None] > 0, seconds[tr], np.nan)
    mean = np.nan_to_num(np.nanmean(face_tr, axis=(0, 1)))
    std = np.nan_to_num(np.nanstd(face_tr, axis=(0, 1)), nan=1.0)
    std[std < 1e-6] = 1.0
    seq = sequences(seconds, valid, mean, std)
    summ = summaries(seconds, valid)

    results: dict = {}
    for state, (_, classes, _) in GROUPS.items():
        y = targets(data, state)
        majority = int(np.bincount(y[tr], minlength=len(classes)).argmax())
        forest = RandomForestClassifier(n_estimators=300, class_weight="balanced", random_state=common.SEED, n_jobs=-1)
        forest.fit(summ[tr], y[tr])
        gru, gru_info = train_gru(seq[tr], y[tr], seq[va], y[va], len(classes), args.epochs)
        preds_va = {
            "majority": np.full(len(va), majority),
            "forest": forest.predict(summ[va]),
            "gru": gru.predict(seq[va], verbose=0).argmax(1),
        }
        val = {m: scores(p, y[va], classes) for m, p in preds_va.items()}
        chosen = max(("forest", "gru"), key=lambda m: val[m]["macro_f1"])
        entry = {"classes": classes, "train_counts": np.bincount(y[tr], minlength=len(classes)).tolist(),
                 "val": val, "chosen_on_val": chosen, "gru_training": gru_info}
        print(f"{state:11s} val macro-F1  majority {val['majority']['macro_f1']:.3f}  forest {val['forest']['macro_f1']:.3f}  "
              f"gru {val['gru']['macro_f1']:.3f}  -> {chosen}")
        if not args.dry_run:
            preds_te = {"majority": np.full(len(te), majority), "forest": forest.predict(summ[te]),
                        "gru": gru.predict(seq[te], verbose=0).argmax(1)}
            entry["test"] = {m: scores(p, y[te], classes) for m, p in preds_te.items()}
            model_dir = common.RESULTS / "models" / "daisee"
            model_dir.mkdir(parents=True, exist_ok=True)
            gru.save(model_dir / f"{state}_gru.h5")
        results[state] = entry

    if args.dry_run:
        print("dry run: code check only, no test set, nothing written")
        return
    summary = {
        "protocol": "train DAiSEE Train, choose on Validation (macro-F1), test once on Test; person-disjoint splits",
        "counts": {s: int((split == s).sum()) for s in SPLITS},
        "feature_code_hash": data["feature_code_hash"],
        "standardisation": {"mean": mean.tolist(), "std": std.tolist(), "features": data["feature_names"]},
        "results": results,
        "seconds": round(time.time() - started),
    }
    path = common.write_result("daisee", summary)
    print(f"wrote {path}")


if __name__ == "__main__":
    main()
