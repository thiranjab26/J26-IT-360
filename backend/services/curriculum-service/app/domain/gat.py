"""GAT readiness model (trained in research notebook 04) run with numpy (FR-05, FR-06).

The forward pass is a copy of `gat_forward_numpy` in notebook 04, which matched
PyTorch to 1.8e-07. Features are graph-agnostic, so a model trained on Junyi
scores the Java PF + DSA graph.
"""

from __future__ import annotations

import hashlib
import io
import json
import math
from collections.abc import Mapping, Sequence
from pathlib import Path

import numpy as np

from app.domain.graph import PrerequisiteGraph
from app.domain.mastery import BktParams, MasteryRecord
from app.domain.recommend import Scores

FEATURES = (
    "mastery",
    "log_evidence",
    "log_depth",
    "log_prereq_count",
    "mean_prereq_mastery",
    "bkt_p_correct",
)
LEARNER_FEATURES = ("overall_correct_rate", "recent_correct_rate", "previous_correct")
RECENT = 5
_BKT_P = FEATURES.index("bkt_p_correct")
_WEIGHTS = ("W", "a_dst", "a_src", "fc1_w", "fc1_b", "fc2_w", "fc2_b")


class ModelError(ValueError):
    """The model file is missing, altered, or does not match the feature spec."""


class GatModel:
    def __init__(
        self, weights: Mapping[str, np.ndarray], heads: int, hidden: int, slope: float, version: str
    ) -> None:
        f, n_learner, width = len(FEATURES), len(LEARNER_FEATURES), heads * hidden
        classifier = weights["fc1_b"].shape[0] if "fc1_b" in weights else 0
        expected = {
            "W": (f, width),
            "a_dst": (heads, hidden),
            "a_src": (heads, hidden),
            "fc1_w": (width + f + n_learner, classifier),
            "fc1_b": (classifier,),
            "fc2_w": (classifier, 1),
            "fc2_b": (1,),
        }
        for name, shape in expected.items():
            if name not in weights or weights[name].shape != shape:
                raise ModelError(f"weight {name} missing or not shaped {shape}")
        self.w = {k: np.asarray(weights[k], dtype=np.float64) for k in _WEIGHTS}
        self.heads, self.hidden, self.slope, self.version = heads, hidden, slope, version

    def forward(
        self, x_t: np.ndarray, x_n: np.ndarray, mask: np.ndarray, x_l: np.ndarray
    ) -> tuple[np.ndarray, np.ndarray]:
        """x_t [B,F], x_n [B,K,F], mask [B,K], x_l [B,L] -> (P(correct) [B], alpha [B,1+K,H])."""
        w, heads, hidden = self.w, self.heads, self.hidden
        b, k, _ = x_n.shape
        nodes = np.concatenate([x_t[:, None], x_n], 1)
        h = (nodes @ w["W"]).reshape(b, 1 + k, heads, hidden)
        score = (h[:, :1] * w["a_dst"]).sum(-1) + (h * w["a_src"]).sum(-1)
        score = np.where(score > 0, score, self.slope * score)
        present = np.concatenate([np.ones((b, 1), bool), mask], 1)
        score = np.where(present[..., None], score, -np.inf)
        score = score - score.max(1, keepdims=True)
        alpha = np.exp(score) / np.exp(score).sum(1, keepdims=True)
        z = (alpha[..., None] * h).sum(1).reshape(b, heads * hidden)
        z = np.where(z > 0, z, np.expm1(np.minimum(z, 0)))
        hidden1 = np.maximum(np.concatenate([z, x_t, x_l], -1) @ w["fc1_w"] + w["fc1_b"], 0)
        p_bkt = np.clip(x_t[:, _BKT_P], 1e-4, 1 - 1e-4)
        logit = np.log(p_bkt / (1 - p_bkt)) + (hidden1 @ w["fc2_w"] + w["fc2_b"])[:, 0]
        return 1 / (1 + np.exp(-logit)), alpha


def load_model(model_path: Path, spec_path: Path, sha256: str) -> GatModel:
    """Checks the SHA-256 and the feature spec before trusting the weights."""
    try:
        data = model_path.read_bytes()
    except OSError as exc:
        raise ModelError(f"model file not readable: {model_path.name}") from exc
    digest = hashlib.sha256(data).hexdigest()
    if digest != sha256.strip().lower():
        raise ModelError(f"checksum mismatch for {model_path.name}")
    try:
        spec = json.loads(spec_path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        raise ModelError(f"feature spec not readable: {spec_path.name}") from exc
    if spec.get("sha256") != digest:
        raise ModelError("feature spec belongs to a different model file")
    if (
        tuple(spec.get("features", ())) != FEATURES
        or tuple(spec.get("learner_features", ())) != LEARNER_FEATURES
    ):
        raise ModelError("feature spec lists different features from this service")
    arch = spec.get("architecture", {})
    try:
        # Loaded from the bytes that were hashed, never re-read from disk.
        with np.load(io.BytesIO(data), allow_pickle=False) as npz:
            weights = {k: npz[k] for k in npz.files}
        return GatModel(
            weights,
            int(arch["heads"]),
            int(arch["hidden"]),
            float(arch["leaky_slope"]),
            str(spec["model_version"]),
        )
    except ModelError:
        raise
    except (KeyError, TypeError, ValueError) as exc:
        raise ModelError(f"model file or spec malformed: {type(exc).__name__}") from exc


def learner_features(history: Sequence[bool]) -> tuple[float, float, float]:
    """Smoothed overall and last-5 correct rate, previous answer (0.5 before the first)."""
    recent = history[-RECENT:]
    return (
        (sum(history) + 1) / (len(history) + 2),
        (sum(recent) + 1) / (len(recent) + 2),
        float(history[-1]) if history else 0.5,
    )


def score(
    model: GatModel,
    graph: PrerequisiteGraph,
    records: Mapping[str, MasteryRecord],
    history: Sequence[bool],
    params: BktParams,
) -> Scores:
    """Readiness for every concept in one batch. Unseen concepts start at p_init, as in training."""
    ids = [c.concept_id for c in graph.concepts]
    mastery = {cid: records[cid].score if cid in records else params.p_init for cid in ids}
    prereqs = {cid: graph.prerequisites_of(cid) for cid in ids}

    def node(cid: str) -> tuple[float, ...]:
        m, ps = mastery[cid], prereqs[cid]
        return (
            m,
            math.log1p(records[cid].evidence_count if cid in records else 0),
            math.log1p(graph.depth(cid)),
            math.log1p(len(ps)),
            sum(mastery[p] for p in ps) / len(ps) if ps else 1.0,
            m * (1 - params.p_slip) + (1 - m) * params.p_guess,
        )

    feats = {cid: node(cid) for cid in ids}
    k = max((len(ps) for ps in prereqs.values()), default=0) or 1
    x_t = np.array([feats[cid] for cid in ids], dtype=np.float64)
    x_n = np.zeros((len(ids), k, len(FEATURES)))
    mask = np.zeros((len(ids), k), bool)
    for i, cid in enumerate(ids):
        for j, p in enumerate(prereqs[cid]):
            x_n[i, j] = feats[p]
            mask[i, j] = True
    x_l = np.tile(np.array(learner_features(history)), (len(ids), 1))

    p, alpha = model.forward(x_t, x_n, mask, x_l)
    if not np.all(np.isfinite(p)) or not np.all(np.isfinite(alpha)):
        raise ModelError("model produced a non-finite value")
    edge_attention = alpha[:, 1:].mean(-1)  # mean over heads, slot 0 is the self-loop
    return Scores(
        version=model.version,
        p_correct={cid: float(p[i]) for i, cid in enumerate(ids)},
        attention={
            cid: {pre: float(edge_attention[i, j]) for j, pre in enumerate(prereqs[cid])}
            for i, cid in enumerate(ids)
        },
    )
