"""TODO P4: trained facial-expression model on landmarks.

Protocol:
  test   RAF-DB official test split (3,068 images), used once at the end;
         FER+ PrivateTest reported as a second test set
  val    a fixed, stratified 10 % of RAF-DB train (seeded); all choices are made here
  train  the rest of RAF-DB train, optionally + ExpW + FER+ Training
Which training mix to keep (RAF only / + ExpW / + ExpW + FER+) is chosen by
validation macro-F1, never by test results.

Input: the 'face' mesh input (head rotation removed; src/core/features/mesh-input.ts).
Only faces the app's FaceMesh found are used; the report states how many.
Macro-F1 is the headline because the classes are unbalanced (Fear, Disgust small).

The hand-picked expression rules in src/demo/mood.ts are not scored here: they
compare each learner with their own 30 s calibration baseline, which single
photos do not have, so there is no fair way to run them on these datasets.

  TF_USE_LEGACY_KERAS=1 python expression.py            # writes results/expression.json
  TF_USE_LEGACY_KERAS=1 python expression.py --dry-run  # RAF-DB only, 3 epochs, validation only; writes nothing
"""

from __future__ import annotations

import argparse
import csv
import os
import time

os.environ.setdefault("TF_USE_LEGACY_KERAS", "1")

import numpy as np

import common

CLASSES = ("neutral", "happy", "sad", "surprise", "fear", "disgust", "anger")

# Each dataset's own label -> index into CLASSES.
RAF_LABELS = {"1": "surprise", "2": "fear", "3": "disgust", "4": "happy", "5": "sad", "6": "anger", "7": "neutral"}
EXPW_LABELS = {"0": "anger", "1": "disgust", "2": "fear", "3": "happy", "4": "sad", "5": "surprise", "6": "neutral"}
# fer2013new.csv vote columns, in file order.
FERPLUS_VOTES = ("neutral", "happiness", "surprise", "sadness", "anger", "disgust", "fear", "contempt", "unknown", "NF")
FERPLUS_TO_CLASS = {"neutral": "neutral", "happiness": "happy", "surprise": "surprise", "sadness": "sad",
                     "anger": "anger", "disgust": "disgust", "fear": "fear"}


# Mood = Positive / Neutral / Negative, grouped from the 7 expressions (decided
# by the owner 30 Oct 2026). Surprise counts as Neutral: it can be good or bad
# news, so it does not push mood either way.
MOODS = ("positive", "neutral", "negative")
MOOD_OF = {"happy": "positive", "neutral": "neutral", "surprise": "neutral",
           "sad": "negative", "fear": "negative", "disgust": "negative", "anger": "negative"}
MOOD_INDEX = np.array([MOODS.index(MOOD_OF[c]) for c in CLASSES])


def encode(names: list[str | None]) -> np.ndarray:
    return np.array([CLASSES.index(n) if n else -1 for n in names])


def raf() -> tuple[common.Landmarked, np.ndarray]:
    d = common.load("raf-db")
    return d, encode([RAF_LABELS[l] for l in d.labels])


def expw() -> tuple[common.Landmarked, np.ndarray]:
    d = common.load("expw")
    return d, encode([EXPW_LABELS[l] for l in d.labels])


def ferplus() -> tuple[common.Landmarked, np.ndarray]:
    """FER+ majority vote; rows whose top vote is contempt/unknown/not-a-face, or tied, get -1 (dropped)."""
    d = common.load("fer2013")
    with open(common.DATASETS / "fer2013" / "fer2013new.csv", newline="") as f:
        rows = list(csv.DictReader(f))
    if len(rows) != len(d.ids):
        raise ValueError(f"fer2013new.csv has {len(rows)} rows, fer2013.csv {len(d.ids)}")
    names: list[str | None] = []
    for r in rows:
        votes = np.array([int(r[v]) for v in FERPLUS_VOTES])
        top = np.flatnonzero(votes == votes.max())
        name = FERPLUS_VOTES[top[0]]
        names.append(FERPLUS_TO_CLASS.get(name) if len(top) == 1 and r["Image name"] else None)
    return d, encode(names)


def stratified_val(labels: np.ndarray, rows: np.ndarray, fraction: float) -> tuple[np.ndarray, np.ndarray]:
    rng = np.random.default_rng(common.SEED)
    val = []
    for c in range(len(CLASSES)):
        members = rows[labels[rows] == c]
        rng.shuffle(members)
        val.extend(members[: int(round(len(members) * fraction))])
    val = np.sort(np.array(val))
    return np.setdiff1d(rows, val), val


def scores(pred: np.ndarray, truth: np.ndarray) -> dict:
    from sklearn.metrics import accuracy_score, confusion_matrix, f1_score

    mood_pred, mood_truth = MOOD_INDEX[pred], MOOD_INDEX[truth]
    return {
        "n": int(len(truth)),
        "mood": {
            "classes": MOODS,
            "accuracy": float(accuracy_score(mood_truth, mood_pred)),
            "macro_f1": float(f1_score(mood_truth, mood_pred, average="macro", labels=range(len(MOODS)))),
            "confusion": confusion_matrix(mood_truth, mood_pred, labels=range(len(MOODS))).tolist(),
        },
        "accuracy": float(accuracy_score(truth, pred)),
        "macro_f1": float(f1_score(truth, pred, average="macro", labels=range(len(CLASSES)))),
        "f1_per_class": dict(zip(CLASSES, f1_score(truth, pred, average=None, labels=range(len(CLASSES))).tolist())),
        "confusion": {"labels": CLASSES, "rows_truth_cols_pred": confusion_matrix(truth, pred, labels=range(len(CLASSES))).tolist()},
    }


def build_mlp(input_length: int):
    import tf_keras as keras

    return keras.Sequential(
        [
            keras.layers.Input((input_length,)),
            keras.layers.Dense(256, activation="relu"),
            keras.layers.Dropout(0.3),
            keras.layers.Dense(128, activation="relu"),
            keras.layers.Dropout(0.3),
            keras.layers.Dense(len(CLASSES), activation="softmax"),
        ]
    )


def train(x_tr, y_tr, x_va, y_va, epochs: int):
    import tf_keras as keras
    from sklearn.utils.class_weight import compute_class_weight

    common.set_seed()
    weights = compute_class_weight("balanced", classes=np.arange(len(CLASSES)), y=y_tr)
    model = build_mlp(x_tr.shape[1])
    model.compile(optimizer=keras.optimizers.Adam(1e-3), loss="sparse_categorical_crossentropy", metrics=["accuracy"])
    stop = keras.callbacks.EarlyStopping(monitor="val_loss", patience=8, restore_best_weights=True)
    history = model.fit(
        x_tr, y_tr, validation_data=(x_va, y_va), epochs=epochs, batch_size=256,
        class_weight=dict(enumerate(weights)), callbacks=[stop], verbose=2,
    )
    return model, {"epochs_run": len(history.history["loss"]),
                   "class_weight": dict(zip(CLASSES, weights.tolist())),
                   "history": {k: [float(v) for v in vs] for k, vs in history.history.items()}}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true", help="RAF-DB only, 3 epochs, nothing written")
    parser.add_argument("--epochs", type=int, default=200)
    args = parser.parse_args()
    started = time.time()

    raf_d, raf_y = raf()
    ok = raf_d.has_features & (raf_y >= 0)
    raf_train_rows, val_rows = stratified_val(raf_y, np.flatnonzero(ok & (raf_d.splits == "train")), 0.10)
    test_rows = np.flatnonzero(ok & (raf_d.splits == "test"))
    x_va, y_va = raf_d.mesh_face[val_rows], raf_y[val_rows]

    sources = {"raf": (raf_d.mesh_face[raf_train_rows], raf_y[raf_train_rows])}
    counts = {"raf_train": int(len(raf_train_rows)), "raf_val": int(len(val_rows)), "raf_test_used": int(len(test_rows)),
              "raf_test_total": int((raf_d.splits == "test").sum()),
              "raf_no_face": int((~raf_d.has_features).sum())}
    fer_test = None
    if not args.dry_run:
        ex_d, ex_y = expw()
        ex_rows = np.flatnonzero(ex_d.has_features & (ex_y >= 0))
        sources["expw"] = (ex_d.mesh_face[ex_rows], ex_y[ex_rows])
        fp_d, fp_y = ferplus()
        fp_ok = fp_d.has_features & (fp_y >= 0)
        fp_tr = np.flatnonzero(fp_ok & (fp_d.splits == "Training"))
        fp_te = np.flatnonzero(fp_ok & (fp_d.splits == "PrivateTest"))
        sources["ferplus"] = (fp_d.mesh_face[fp_tr], fp_y[fp_tr])
        fer_test = (fp_d.mesh_face[fp_te], fp_y[fp_te])
        counts.update({"expw_used": int(len(ex_rows)), "expw_total": len(ex_d.ids),
                       "ferplus_train_used": int(len(fp_tr)), "ferplus_privatetest_used": int(len(fp_te))})
        if not raf_d.feature_code_hash == ex_d.feature_code_hash == fp_d.feature_code_hash:
            raise ValueError("datasets were featurised with different feature code")

    mixes = [("raf",), ("raf", "expw"), ("raf", "expw", "ferplus")] if not args.dry_run else [("raf",)]
    epochs = 3 if args.dry_run else args.epochs
    candidates = []
    for mix in mixes:
        x_tr = np.concatenate([sources[s][0] for s in mix])
        y_tr = np.concatenate([sources[s][1] for s in mix])
        model, info = train(x_tr, y_tr, x_va, y_va, epochs)
        val = scores(model.predict(x_va, verbose=0).argmax(1), y_va)
        print(f"mix {'+'.join(mix):20s} n_train {len(y_tr):6d}  val macro-F1 {val['macro_f1']:.3f}  acc {val['accuracy']:.3f}")
        candidates.append({"mix": mix, "n_train": int(len(y_tr)), "val": val, "training": info, "model": model})

    best = max(candidates, key=lambda c: c["val"]["macro_f1"])
    if args.dry_run:
        # The test split is touched once, by the real run only.
        print("dry run: code check only, test set not evaluated, nothing written")
        return
    test = scores(best["model"].predict(raf_d.mesh_face[test_rows], verbose=0).argmax(1), raf_y[test_rows])
    print(f"chosen {'+'.join(best['mix'])}: RAF-DB test macro-F1 {test['macro_f1']:.3f}  accuracy {test['accuracy']:.3f}  (n={test['n']})")
    summary = {
        "dry_run": args.dry_run,
        "classes": CLASSES,
        "protocol": "select training mix on stratified 10% of RAF-DB train (macro-F1); test once on RAF-DB official test",
        "feature_code_hash": raf_d.feature_code_hash,
        "counts": counts,
        "candidates": [{k: v for k, v in c.items() if k != "model"} for c in candidates],
        "chosen_mix": best["mix"],
        "test_raf": test,
    }
    if fer_test is not None:
        summary["test_ferplus_privatetest"] = scores(best["model"].predict(fer_test[0], verbose=0).argmax(1), fer_test[1])
        print(f"FER+ PrivateTest macro-F1 {summary['test_ferplus_privatetest']['macro_f1']:.3f}")
    summary["seconds"] = round(time.time() - started)
    path = common.write_result("expression", summary)
    model_dir = common.RESULTS / "models" / "expression"
    model_dir.mkdir(parents=True, exist_ok=True)
    best["model"].save(model_dir / "expression_mlp.h5")
    print(f"wrote {path} and {model_dir}")


if __name__ == "__main__":
    main()
