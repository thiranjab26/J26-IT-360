"""TODO P5 / C1: export a trained model to TF.js and prove the browser computes the same thing.

Exports as a TF.js *graph* model (tf_saved_model format), which the app loads
with @tensorflow/tfjs-converter, already a dependency, so no new runtime package.
Writes next to the model a parity fixture: a few real test inputs and the
Keras outputs. `pnpm model-parity <dir>` (packages/load-sensor) runs the
exported model in TF.js and fails if any output differs by more than 1e-4.

The fixture holds landmark-derived numbers only (no pixels) but comes from
licensed datasets, so it stays in research/c2-load/results/ (gitignored).

  TF_USE_LEGACY_KERAS=1 python export.py head_pose     # results/models/head_pose/head_pose_mlp.h5
  TF_USE_LEGACY_KERAS=1 python export.py expression
  TF_USE_LEGACY_KERAS=1 python export.py --smoke       # untrained model of the same shape: round-trip check only
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import tempfile
from pathlib import Path

os.environ.setdefault("TF_USE_LEGACY_KERAS", "1")

import numpy as np

import common

PACKAGE = Path(__file__).resolve().parents[3] / "packages" / "load-sensor"
PARITY_ROWS = 32


def export(model, out_dir: Path, fixture_inputs: np.ndarray, meta: dict) -> None:
    import tensorflow as tf
    import tensorflowjs as tfjs

    if out_dir.exists():
        shutil.rmtree(out_dir)
    out_dir.mkdir(parents=True)
    with tempfile.TemporaryDirectory() as tmp:
        saved = Path(tmp) / "saved_model"
        # A concrete float32 [batch, length] signature: the browser feeds exactly this.
        spec = tf.TensorSpec([None, fixture_inputs.shape[1]], tf.float32, name="input")
        fn = tf.function(lambda x: model(x, training=False)).get_concrete_function(spec)
        tf.saved_model.save(model, str(saved), signatures={"serving_default": fn})
        tfjs.converters.convert_tf_saved_model(str(saved), str(out_dir))

    outputs = model.predict(fixture_inputs, verbose=0)
    parity = {"inputs": fixture_inputs.astype(np.float32).tolist(), "outputs": outputs.astype(np.float32).tolist(), "tolerance": 1e-4}
    parity_dir = common.RESULTS / "parity"
    parity_dir.mkdir(parents=True, exist_ok=True)
    (parity_dir / f"{out_dir.name}.json").write_text(json.dumps(parity))
    (out_dir / "meta.json").write_text(json.dumps(meta, indent=2) + "\n")
    print(f"exported {out_dir} ({sum(f.stat().st_size for f in out_dir.iterdir())} bytes); parity fixture {parity_dir / (out_dir.name + '.json')}")


def main() -> None:
    parser = argparse.ArgumentParser()
    # expression_tuned: the validation-tuned second pass (expression_tune.py); it
    # ships to the same public/models/expression/ folder as the first run would.
    parser.add_argument("model", nargs="?", choices=("head_pose", "expression", "expression_tuned"))
    parser.add_argument("--smoke", action="store_true")
    args = parser.parse_args()
    common.set_seed()
    import tf_keras as keras

    if args.smoke:
        import head_pose

        model = head_pose.build_mlp(1434)
        inputs = np.random.default_rng(common.SEED).normal(size=(PARITY_ROWS, 1434)).astype(np.float32)
        out = common.RESULTS / "smoke" / "round_trip"
        export(model, out, inputs, {"smoke": True})
        return
    if args.model is None:
        parser.error("name a model or pass --smoke")

    results = json.loads((common.RESULTS / f"{args.model}.json").read_text())
    if results.get("dry_run"):
        raise SystemExit("refusing to export a dry-run result")
    model = keras.models.load_model(common.RESULTS / "models" / args.model / f"{args.model}_mlp.h5")
    if args.model == "head_pose":
        data = common.load("aflw2000")
        rows = np.flatnonzero(data.has_features)[:PARITY_ROWS]
        inputs = data.mesh_camera[rows]
        meta = {
            "model": "head_pose_mlp",
            "input": "meshInput(mesh, 'camera'), float32 [batch, 1434] (src/core/features/mesh-input.ts)",
            "output": "yaw, pitch, roll in degrees, app convention (src/core/features/head-pose.ts)",
            "sign_from_train": results["sign_from_train"],
            "test_aflw2000": {k: results["results"]["mlp"][k] for k in ("mae_yaw", "mae_pitch", "mae_roll", "mae_mean", "n")},
        }
    else:
        data = common.load("raf-db")
        rows = np.flatnonzero(data.has_features & (data.splits == "test"))[:PARITY_ROWS]
        inputs = data.mesh_face[rows]
        meta = {
            "model": f"{args.model}_mlp",
            "input": "meshInput(mesh, 'face'), float32 [batch, 1434] (src/core/features/mesh-input.ts)",
            "output": "softmax probabilities over classes",
            "classes": results["classes"],
            "training_mix": results["chosen_mix"],
            "test_rafdb": {k: results["test_raf"][k] for k in ("accuracy", "macro_f1", "n")},
        }
        if results.get("second_pass"):
            meta["test_use_note"] = results["test_use_note"]
    meta["feature_code_hash"] = results["feature_code_hash"]
    meta["results_file"] = f"research/c2-load/results/{args.model}.json"
    folder = "head-pose" if args.model == "head_pose" else "expression"
    export(model, PACKAGE / "public" / "models" / folder, inputs, meta)


if __name__ == "__main__":
    main()
