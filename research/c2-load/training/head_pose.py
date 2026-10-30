"""TODO P3: trained head-pose model vs the app's geometric head pose.

Protocol (the usual one for landmark/image head-pose papers, so numbers compare):
  train 300W-LP (its train split), choose settings on its val split,
  test once on AFLW2000-3D, keeping images with every angle within ±99°.
Only faces the app's FaceMesh found are used (the app has no pose without a
face); the report states how many test images that leaves.

Labels: Pose_Para[:3] in each .mat = pitch, yaw, roll in radians. The dataset's
sign convention differs from the app's (head-pose.ts). The per-axis sign is
taken from the correlation between the geometric pose and the labels on the
300W-LP *training* split, never from the test set. Every model then outputs
degrees in the app's convention.

Models compared on the same test rows:
  geometric  the current solver (src/core/features/head-pose.ts), no training
  ridge      linear regression on the 'camera' mesh input
  mlp        small dense network on the same input (the candidate to ship)

  TF_USE_LEGACY_KERAS=1 python head_pose.py            # full run, writes results/head_pose.json
  TF_USE_LEGACY_KERAS=1 python head_pose.py --dry-run  # code check on AFLW halves; writes nothing
"""

from __future__ import annotations

import argparse
import os
import time

os.environ.setdefault("TF_USE_LEGACY_KERAS", "1")

import numpy as np
import scipy.io as sio

import common

AXES = ("yaw", "pitch", "roll")
POSE_LIMIT_DEG = 99.0


def pose_labels(data: common.Landmarked) -> np.ndarray:
    """[N, 3] yaw, pitch, roll in degrees (dataset convention), cached next to the landmarks."""
    cache = common.LANDMARKS / f"{data.dataset}.pose_labels.npy"
    if cache.exists():
        labels = np.load(cache)
        if labels.shape == (len(data.ids), 3):
            return labels
    root = {"aflw2000": common.DATASETS / "aflw2000-3d", "300w-lp": common.DATASETS / "300w-lp"}[data.dataset]
    labels = np.empty((len(data.ids), 3), dtype=np.float32)
    for i, image_id in enumerate(data.ids):
        mat = sio.loadmat(root / image_id.replace(".jpg", ".mat"), variable_names=["Pose_Para"])
        pitch, yaw, roll = np.asarray(mat["Pose_Para"]).ravel()[:3]
        labels[i] = np.degrees([yaw, pitch, roll])
    np.save(cache, labels)
    return labels


def geometric(data: common.Landmarked) -> np.ndarray:
    idx = [data.signal_names.index(a) for a in AXES]
    return data.signals[:, idx]


def usable(data: common.Landmarked, labels: np.ndarray) -> np.ndarray:
    return data.has_features & (np.abs(labels) <= POSE_LIMIT_DEG).all(axis=1)


def sign_convention(geo: np.ndarray, labels: np.ndarray) -> np.ndarray:
    """+1/-1 per axis so that sign * label is in the app's convention."""
    signs = np.empty(3)
    for k in range(3):
        r = np.corrcoef(geo[:, k], labels[:, k])[0, 1]
        if not abs(r) > 0.3:
            raise ValueError(f"{AXES[k]}: geometric pose and labels barely correlate (r={r:.2f}); check the label order")
        signs[k] = np.sign(r)
    return signs


def mae_report(pred: np.ndarray, truth: np.ndarray) -> dict:
    err = np.abs(pred - truth)
    report = {f"mae_{a}": float(err[:, k].mean()) for k, a in enumerate(AXES)}
    report["mae_mean"] = float(err.mean())
    # Error by how far the head is turned: landmark methods degrade at large yaw.
    bins = {}
    for lo, hi in ((0, 30), (30, 60), (60, 99.01)):
        m = (np.abs(truth[:, 0]) >= lo) & (np.abs(truth[:, 0]) < hi)
        bins[f"yaw_{lo}_{int(hi)}"] = {"n": int(m.sum()), "mae_mean": float(err[m].mean()) if m.any() else None}
    report["by_abs_yaw"] = bins
    report["n"] = int(len(truth))
    return report


def train_ridge(x_tr, y_tr, x_va, y_va):
    from sklearn.linear_model import Ridge

    best = None
    for alpha in (0.01, 0.1, 1.0, 10.0, 100.0):
        model = Ridge(alpha=alpha).fit(x_tr, y_tr)
        val = float(np.abs(model.predict(x_va) - y_va).mean())
        if best is None or val < best[0]:
            best = (val, alpha, model)
    return best[2], {"alpha": best[1], "val_mae_mean": best[0]}


def build_mlp(input_length: int):
    import tf_keras as keras

    # Small on purpose: it runs every frame in the browser next to FaceMesh (NFR1).
    return keras.Sequential(
        [
            keras.layers.Input((input_length,)),
            keras.layers.Dense(256, activation="relu"),
            keras.layers.Dropout(0.1),
            keras.layers.Dense(128, activation="relu"),
            keras.layers.Dense(3),
        ]
    )


def train_mlp(x_tr, y_tr, x_va, y_va, epochs: int):
    import tf_keras as keras

    model = build_mlp(x_tr.shape[1])
    model.compile(optimizer=keras.optimizers.Adam(1e-3), loss="mae")
    stop = keras.callbacks.EarlyStopping(monitor="val_loss", patience=8, restore_best_weights=True)
    history = model.fit(
        x_tr, y_tr, validation_data=(x_va, y_va), epochs=epochs, batch_size=256, callbacks=[stop], verbose=2
    )
    return model, {
        "epochs_run": len(history.history["loss"]),
        "best_val_mae_mean": float(min(history.history["val_loss"])),
        "history": {k: [float(v) for v in vs] for k, vs in history.history.items()},
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true", help="split AFLW2000 in halves to test the code; no results")
    parser.add_argument("--epochs", type=int, default=200)
    args = parser.parse_args()
    common.set_seed()
    started = time.time()

    test = common.load("aflw2000")
    test_labels = pose_labels(test)
    test_rows = usable(test, test_labels)

    if args.dry_run:
        rows = np.flatnonzero(test_rows)
        half = len(rows) // 2
        tr_rows, va_rows, te_rows = rows[: half // 2 * 2 : 2], rows[1 : half : 2], rows[half:]
        train = val = test
        train_labels = val_labels = test_labels
        args.epochs = min(args.epochs, 5)
    else:
        train = common.load("300w-lp")
        if train.feature_code_hash != test.feature_code_hash:
            raise ValueError("300w-lp and aflw2000 features come from different feature code")
        train_labels = pose_labels(train)
        ok = usable(train, train_labels)
        tr_rows = np.flatnonzero(ok & (train.splits == "train"))
        va_rows = np.flatnonzero(ok & (train.splits == "val"))
        te_rows = np.flatnonzero(test_rows)
        val, val_labels = train, train_labels

    signs = sign_convention(geometric(train)[tr_rows], train_labels[tr_rows])
    y_tr = train_labels[tr_rows] * signs
    y_va = val_labels[va_rows] * signs
    y_te = test_labels[te_rows] * signs
    x_tr, x_va, x_te = train.mesh_camera[tr_rows], val.mesh_camera[va_rows], test.mesh_camera[te_rows]

    results = {"geometric": mae_report(geometric(test)[te_rows], y_te)}
    ridge, ridge_info = train_ridge(x_tr, y_tr, x_va, y_va)
    results["ridge"] = {**mae_report(ridge.predict(x_te), y_te), "selection": ridge_info}
    mlp, mlp_info = train_mlp(x_tr, y_tr, x_va, y_va, args.epochs)
    results["mlp"] = {**mae_report(mlp.predict(x_te, verbose=0), y_te), "training": mlp_info}

    summary = {
        "dry_run": args.dry_run,
        "protocol": "train 300W-LP train split, select on 300W-LP val split, test AFLW2000-3D (|angles| <= 99 deg)",
        "units": "degrees, app convention (src/core/features/head-pose.ts)",
        "sign_from_train": dict(zip(AXES, signs.tolist())),
        "feature_code_hash": test.feature_code_hash,
        "counts": {
            "train": int(len(tr_rows)),
            "val": int(len(va_rows)),
            "test_used": int(len(te_rows)),
            "test_total": len(test.ids),
            "test_no_face": int((~test.has_features).sum()),
            "test_outside_99deg": int((test.has_features & ~test_rows).sum()),
        },
        "results": results,
        "seconds": round(time.time() - started),
    }
    if args.dry_run:
        # The dry run fits and scores on AFLW2000, the real test set, so it shows
        # no error numbers: nothing may be chosen by looking at test results.
        print(f"dry run ok: {summary['counts']}, all three models produced finite predictions:",
              all(np.isfinite(results[n]["mae_mean"]) for n in results))
        print("dry run: code check only, no metrics shown, nothing written")
        return
    for name in ("geometric", "ridge", "mlp"):
        r = results[name]
        print(f"{name:9s} MAE yaw {r['mae_yaw']:.2f}  pitch {r['mae_pitch']:.2f}  roll {r['mae_roll']:.2f}  mean {r['mae_mean']:.2f}  (n={r['n']})")
    path = common.write_result("head_pose", summary)
    model_dir = common.RESULTS / "models" / "head_pose"
    model_dir.mkdir(parents=True, exist_ok=True)
    mlp.save(model_dir / "head_pose_mlp.h5")
    print(f"wrote {path} and {model_dir}")


if __name__ == "__main__":
    main()
