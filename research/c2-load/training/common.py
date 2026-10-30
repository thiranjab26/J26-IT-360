"""Shared helpers for the C2 trained-model scripts (TODO Milestone P).

Inputs are the files written by the TypeScript tools in packages/load-sensor:
  pnpm extract-landmarks <dataset>      -> <dataset>.csv (+ .npy landmarks)
  pnpm landmarks-to-features <dataset>  -> <dataset>.signals.npy, .mesh_camera.npy,
                                           .mesh_face.npy, .features.json
Python never computes a feature itself (CLAUDE.md "one source of truth").
"""

from __future__ import annotations

import csv
import json
import os
import random
from dataclasses import dataclass
from pathlib import Path

import numpy as np

# WSL path of C:\datasets. Public datasets stay outside the repo (invariant 7).
DATASETS = Path(os.environ.get("C2_DATASETS", "/mnt/c/datasets"))
LANDMARKS = DATASETS / "landmarks"
RESULTS = Path(__file__).resolve().parent.parent / "results"

SEED = 1234


def set_seed(seed: int = SEED) -> None:
    random.seed(seed)
    np.random.seed(seed)
    try:
        import tensorflow as tf

        tf.random.set_seed(seed)
    except ImportError:
        pass


@dataclass(frozen=True)
class Landmarked:
    """One dataset's rows, aligned with its landmark files."""

    dataset: str
    ids: list[str]
    splits: np.ndarray  # str
    labels: list[str]  # dataset's raw label strings ('' where labels live elsewhere)
    has_features: np.ndarray  # bool: a face was found and every feature is finite
    signals: np.ndarray  # [N, 13] float32, NaN rows where has_features is False
    signal_names: list[str]
    mesh_camera: np.ndarray  # [N, 1434]
    mesh_face: np.ndarray  # [N, 1434]
    feature_code_hash: str


def load(dataset: str) -> Landmarked:
    meta = json.loads((LANDMARKS / f"{dataset}.features.json").read_text())
    with open(LANDMARKS / f"{dataset}.csv", newline="") as f:
        rows = list(csv.DictReader(f))
    if len(rows) != meta["rows"]:
        raise ValueError(f"{dataset}: csv has {len(rows)} rows, features.json {meta['rows']}")
    for i, r in enumerate(rows):
        if int(r["index"]) != i:
            raise ValueError(f"{dataset}: csv row {i} has index {r['index']}")

    signals = np.load(LANDMARKS / meta["signals"]["file"])
    mesh_camera = np.load(LANDMARKS / meta["mesh_camera"]["file"])
    mesh_face = np.load(LANDMARKS / meta["mesh_face"]["file"])
    for name, arr in (("signals", signals), ("mesh_camera", mesh_camera), ("mesh_face", mesh_face)):
        if arr.shape[0] != len(rows):
            raise ValueError(f"{dataset}: {name} has {arr.shape[0]} rows, csv {len(rows)}")

    has = np.isfinite(mesh_face).all(axis=1) & np.isfinite(mesh_camera).all(axis=1)
    has &= np.isfinite(signals).all(axis=1)
    # Rows the extractor marked as "no face" must have no features, and vice versa
    # every row with features must be a found face.
    found = np.array([r["found"] == "1" for r in rows])
    if (has & ~found).any():
        raise ValueError(f"{dataset}: features on rows the extractor marked as no face")
    if meta["rows_with_features"] != int(has.sum()):
        raise ValueError(f"{dataset}: {int(has.sum())} usable rows, features.json says {meta['rows_with_features']}")

    return Landmarked(
        dataset=dataset,
        ids=[r["id"] for r in rows],
        splits=np.array([r["split"] for r in rows]),
        labels=[r["label"] for r in rows],
        has_features=has,
        signals=signals,
        signal_names=list(meta["signals"]["columns"]),
        mesh_camera=mesh_camera,
        mesh_face=mesh_face,
        feature_code_hash=meta["feature_code_hash"],
    )


def write_result(name: str, result: dict) -> Path:
    """Writes a results JSON under research/c2-load/results/ (gitignored; regenerate with the script)."""
    RESULTS.mkdir(parents=True, exist_ok=True)
    path = RESULTS / f"{name}.json"
    path.write_text(json.dumps(result, indent=2, default=_json_default) + "\n")
    return path


def _json_default(o):
    if isinstance(o, (np.integer,)):
        return int(o)
    if isinstance(o, (np.floating,)):
        return float(o)
    if isinstance(o, np.ndarray):
        return o.tolist()
    raise TypeError(type(o))
