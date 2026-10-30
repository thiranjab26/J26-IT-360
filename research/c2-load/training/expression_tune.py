"""TODO P4, second pass: tune the expression model on validation, then test once more.

Why a second pass (owner decision, 30 Oct 2026): the first run (expression.py,
results/expression.json, RAF-DB test macro-F1 0.398) underfitted: training
accuracy 0.46 was no higher than validation. This script searches a small grid
using validation macro-F1 only, then scores the chosen model on the test sets.
The RAF-DB test set has therefore been used twice; the report must give both
numbers. results/expression.json is left untouched.

Same data, split and classes as expression.py. Grid:
  hidden layers  (256, 128) [the first run's], (512, 256), (512, 256, 128)
  dropout        0.1, 0.3
  standardise    no, yes (per-input mean/std of the training rows, built into
                 the model as its first layer, so the browser needs no extra code)
on RAF-DB train; the best setting is then also trained on RAF-DB + ExpW, and
the better of the two on validation is kept.

  TF_USE_LEGACY_KERAS=1 python expression_tune.py   # writes results/expression_tuned.json + model
"""

from __future__ import annotations

import itertools
import os
import time

os.environ.setdefault("TF_USE_LEGACY_KERAS", "1")

import numpy as np

import common
import expression as ex

GRID_HIDDEN = ((256, 128), (512, 256), (512, 256, 128))
GRID_DROPOUT = (0.1, 0.3)
GRID_STANDARDISE = (False, True)


def build(input_length: int, hidden: tuple[int, ...], dropout: float, stats: tuple[np.ndarray, np.ndarray] | None):
    import tf_keras as keras

    layers = [keras.layers.Input((input_length,))]
    if stats is not None:
        mean, std = stats
        # Fixed (not trained) standardisation: exports as plain subtract/divide ops.
        layers.append(keras.layers.Normalization(mean=mean, variance=std**2))
    for units in hidden:
        layers += [keras.layers.Dense(units, activation="relu"), keras.layers.Dropout(dropout)]
    layers.append(keras.layers.Dense(len(ex.CLASSES), activation="softmax"))
    return keras.Sequential(layers)


def fit(x_tr, y_tr, x_va, y_va, hidden, dropout, standardise):
    import tf_keras as keras
    from sklearn.utils.class_weight import compute_class_weight

    common.set_seed()
    stats = None
    if standardise:
        std = x_tr.std(axis=0)
        std[std < 1e-6] = 1.0
        stats = (x_tr.mean(axis=0), std)
    model = build(x_tr.shape[1], hidden, dropout, stats)
    weights = compute_class_weight("balanced", classes=np.arange(len(ex.CLASSES)), y=y_tr)
    model.compile(optimizer=keras.optimizers.Adam(1e-3), loss="sparse_categorical_crossentropy", metrics=["accuracy"])
    stop = keras.callbacks.EarlyStopping(monitor="val_loss", patience=15, restore_best_weights=True)
    hist = model.fit(x_tr, y_tr, validation_data=(x_va, y_va), epochs=300, batch_size=256,
                     class_weight=dict(enumerate(weights)), callbacks=[stop], verbose=0)
    val = ex.scores(model.predict(x_va, verbose=0).argmax(1), y_va)
    info = {"epochs_run": len(hist.history["loss"]),
            "train_accuracy_last": float(hist.history["accuracy"][-1]),
            "best_val_loss": float(min(hist.history["val_loss"]))}
    return model, val, info


def main() -> None:
    started = time.time()
    raf_d, raf_y = ex.raf()
    ok = raf_d.has_features & (raf_y >= 0)
    tr_rows, va_rows = ex.stratified_val(raf_y, np.flatnonzero(ok & (raf_d.splits == "train")), 0.10)
    te_rows = np.flatnonzero(ok & (raf_d.splits == "test"))
    x_tr, y_tr = raf_d.mesh_face[tr_rows], raf_y[tr_rows]
    x_va, y_va = raf_d.mesh_face[va_rows], raf_y[va_rows]

    trials = []
    best = None
    for hidden, dropout, standardise in itertools.product(GRID_HIDDEN, GRID_DROPOUT, GRID_STANDARDISE):
        model, val, info = fit(x_tr, y_tr, x_va, y_va, hidden, dropout, standardise)
        cfg = {"mix": ["raf"], "hidden": list(hidden), "dropout": dropout, "standardise": standardise}
        trials.append({**cfg, "val": val, "training": info})
        print(f"raf {hidden} dropout {dropout} std {standardise}: val macro-F1 {val['macro_f1']:.3f} "
              f"acc {val['accuracy']:.3f} (train acc {info['train_accuracy_last']:.3f}, {info['epochs_run']} epochs)", flush=True)
        if best is None or val["macro_f1"] > best["val"]["macro_f1"]:
            best = {**cfg, "val": val, "model": model}

    ex_d, ex_y = ex.expw()
    ex_rows = np.flatnonzero(ex_d.has_features & (ex_y >= 0))
    x_mix = np.concatenate([x_tr, ex_d.mesh_face[ex_rows]])
    y_mix = np.concatenate([y_tr, ex_y[ex_rows]])
    model, val, info = fit(x_mix, y_mix, x_va, y_va, tuple(best["hidden"]), best["dropout"], best["standardise"])
    cfg = {"mix": ["raf", "expw"], "hidden": best["hidden"], "dropout": best["dropout"], "standardise": best["standardise"]}
    trials.append({**cfg, "val": val, "training": info})
    print(f"raf+expw with the best setting: val macro-F1 {val['macro_f1']:.3f}", flush=True)
    if val["macro_f1"] > best["val"]["macro_f1"]:
        best = {**cfg, "val": val, "model": model}

    chosen = best.pop("model")
    test = ex.scores(chosen.predict(raf_d.mesh_face[te_rows], verbose=0).argmax(1), raf_y[te_rows])
    fp_d, fp_y = ex.ferplus()
    fp_rows = np.flatnonzero(fp_d.has_features & (fp_y >= 0) & (fp_d.splits == "PrivateTest"))
    fer = ex.scores(chosen.predict(fp_d.mesh_face[fp_rows], verbose=0).argmax(1), fp_y[fp_rows])
    print(f"chosen {best}: RAF-DB test macro-F1 {test['macro_f1']:.3f} accuracy {test['accuracy']:.3f}; "
          f"FER+ PrivateTest macro-F1 {fer['macro_f1']:.3f}", flush=True)

    summary = {
        "second_pass": True,
        "test_use_note": "RAF-DB test used twice: first run (expression.json) and this validation-tuned run.",
        "classes": ex.CLASSES,
        "protocol": "grid on stratified 10% of RAF-DB train (macro-F1); best also tried with +ExpW; test once more",
        "feature_code_hash": raf_d.feature_code_hash,
        "counts": {"raf_train": int(len(tr_rows)), "raf_val": int(len(va_rows)), "raf_test_used": int(len(te_rows)),
                   "raf_test_total": int((raf_d.splits == "test").sum()), "ferplus_privatetest_used": int(len(fp_rows))},
        "trials": trials,
        "chosen": best,
        "chosen_mix": best["mix"],
        "test_raf": test,
        "test_ferplus_privatetest": fer,
        "seconds": round(time.time() - started),
    }
    path = common.write_result("expression_tuned", summary)
    model_dir = common.RESULTS / "models" / "expression_tuned"
    model_dir.mkdir(parents=True, exist_ok=True)
    chosen.save(model_dir / "expression_tuned_mlp.h5")
    print(f"wrote {path} and {model_dir}")


if __name__ == "__main__":
    main()
