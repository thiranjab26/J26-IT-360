"""gat-v2 numpy inference, checksum loading, model-ranked recommendations and fallback."""

from __future__ import annotations

import hashlib
import json
import uuid
from datetime import UTC, datetime
from pathlib import Path

import numpy as np
import pytest
from fastapi.testclient import TestClient

from app.config import get_settings
from app.db.graph_wiring import GraphRuntime
from app.domain.gat import (
    FEATURES,
    LEARNER_FEATURES,
    GatModel,
    ModelError,
    learner_features,
    load_model,
    score,
)
from app.domain.graph import Concept, Edge, PrerequisiteGraph
from app.domain.graph_loader import GraphCache, GraphLoader
from app.domain.learner import Learner
from app.domain.mastery import DEFAULT_PARAMS, MasteryRecord
from app.domain.recommend import Scores, recommend
from app.domain.study import Study
from app.main import SERVICE_ROOT, create_app, load_readiness_model
from tests.unit.fakes import FakeAssessmentRepository
from tests.unit.test_graph_api import Source
from tests.unit.test_mastery_api import PREFIX, STUDENT, USER, FakeRepository
from tests.unit.test_recommend import graph as course_graph

HEADS, HIDDEN, CLASSIFIER = 2, 3, 4
F, L = len(FEATURES), len(LEARNER_FEATURES)


def weights(seed: int = 0, zero_correction: bool = False) -> dict[str, np.ndarray]:
    rng = np.random.default_rng(seed)
    w = {
        "W": rng.normal(size=(F, HEADS * HIDDEN)),
        "a_dst": rng.normal(size=(HEADS, HIDDEN)),
        "a_src": rng.normal(size=(HEADS, HIDDEN)),
        "fc1_w": rng.normal(size=(HEADS * HIDDEN + F + L, CLASSIFIER)),
        "fc1_b": rng.normal(size=(CLASSIFIER,)),
        "fc2_w": rng.normal(size=(CLASSIFIER, 1)),
        "fc2_b": rng.normal(size=(1,)),
    }
    if zero_correction:
        w["fc2_w"][:] = 0
        w["fc2_b"][:] = 0
    return {k: v.astype(np.float32) for k, v in w.items()}


def model(**kwargs) -> GatModel:  # noqa: ANN003
    return GatModel(weights(**kwargs), HEADS, HIDDEN, 0.2, "gat-v2")


def write_model(folder: Path, spec_changes: dict | None = None) -> tuple[Path, Path, str]:
    model_path = folder / "gat-v2.npz"
    np.savez(model_path, **weights())
    sha = hashlib.sha256(model_path.read_bytes()).hexdigest()
    spec = {
        "model_version": "gat-v2",
        "features": list(FEATURES),
        "learner_features": list(LEARNER_FEATURES),
        "architecture": {"heads": HEADS, "hidden": HIDDEN, "leaky_slope": 0.2},
        "sha256": sha,
    } | (spec_changes or {})
    spec_path = folder / "feature_spec.json"
    spec_path.write_text(json.dumps(spec))
    return model_path, spec_path, sha


def record(score_: float, count: int = 3) -> MasteryRecord:
    return MasteryRecord(score_, count, False, datetime.now(UTC))


# --- loading ----------------------------------------------------------------


def test_a_model_with_the_right_checksum_and_spec_loads(tmp_path: Path) -> None:
    model_path, spec_path, sha = write_model(tmp_path)
    loaded = load_model(model_path, spec_path, sha.upper())
    assert loaded.version == "gat-v2"
    assert loaded.heads == HEADS and loaded.hidden == HIDDEN


def test_a_changed_model_file_is_rejected(tmp_path: Path) -> None:
    model_path, spec_path, sha = write_model(tmp_path)
    model_path.write_bytes(model_path.read_bytes() + b"x")
    with pytest.raises(ModelError, match="checksum"):
        load_model(model_path, spec_path, sha)


def test_a_missing_model_file_is_rejected(tmp_path: Path) -> None:
    with pytest.raises(ModelError, match="not readable"):
        load_model(tmp_path / "gat-v2.npz", tmp_path / "feature_spec.json", "0" * 64)


@pytest.mark.parametrize(
    ("changes", "message"),
    [
        ({"sha256": "0" * 64}, "different model"),
        ({"features": ["mastery"]}, "different features"),
        ({"learner_features": []}, "different features"),
        ({"architecture": {"heads": 3, "hidden": HIDDEN, "leaky_slope": 0.2}}, "weight W"),
        ({"architecture": {}}, "malformed"),
    ],
)
def test_a_spec_that_does_not_match_is_rejected(
    tmp_path: Path, changes: dict, message: str
) -> None:
    model_path, spec_path, sha = write_model(tmp_path, changes)
    with pytest.raises(ModelError, match=message):
        load_model(model_path, spec_path, sha)


def test_the_service_falls_back_to_rules_without_a_usable_model(tmp_path: Path) -> None:
    settings = get_settings()
    assert load_readiness_model(settings.model_copy(update={"model_path": ""})) is None
    missing = settings.model_copy(update={"model_path": str(tmp_path / "nothing.npz")})
    assert load_readiness_model(missing) is None


# --- forward pass -----------------------------------------------------------


def batch(rng: np.random.Generator, b: int, k: int) -> tuple[np.ndarray, ...]:
    x_t = rng.uniform(0.05, 0.95, size=(b, F))
    x_n = rng.uniform(0.05, 0.95, size=(b, k, F))
    mask = np.zeros((b, k), bool)
    mask[:, :2] = True
    x_l = rng.uniform(0.1, 0.9, size=(b, L))
    return x_t, x_n, mask, x_l


def test_with_a_zero_correction_the_model_equals_bkt() -> None:
    x_t, x_n, mask, x_l = batch(np.random.default_rng(1), 8, 3)
    p, _ = model(zero_correction=True).forward(x_t, x_n, mask, x_l)
    np.testing.assert_allclose(p, x_t[:, FEATURES.index("bkt_p_correct")], atol=1e-12)


def test_attention_sums_to_one_and_skips_padding() -> None:
    x_t, x_n, mask, x_l = batch(np.random.default_rng(2), 8, 4)
    _, alpha = model().forward(x_t, x_n, mask, x_l)
    np.testing.assert_allclose(alpha.sum(1), 1.0)
    assert np.all(alpha[:, 3:] == 0)  # slots 3 and 4 are padding


def test_extra_padding_does_not_change_the_prediction() -> None:
    x_t, x_n, mask, x_l = batch(np.random.default_rng(3), 8, 2)
    padded_n = np.concatenate([x_n, np.ones((8, 5, F))], 1)
    padded_mask = np.concatenate([mask, np.zeros((8, 5), bool)], 1)
    m = model()
    np.testing.assert_allclose(
        m.forward(x_t, x_n, mask, x_l)[0], m.forward(x_t, padded_n, padded_mask, x_l)[0]
    )


@pytest.mark.parametrize(
    ("history", "expected"),
    [
        ([], (0.5, 0.5, 0.5)),
        ([False], (1 / 3, 1 / 3, 0.0)),
        ([True, True, False, True, True, True, True], (7 / 9, 5 / 7, 1.0)),
    ],
)
def test_learner_features_match_notebook_04(history: list[bool], expected: tuple) -> None:
    assert learner_features(history) == pytest.approx(expected)


def test_scores_cover_every_concept_and_every_prerequisite_edge() -> None:
    g = course_graph()
    result = score(model(), g, {"prog.variables": record(0.9)}, [True, False], DEFAULT_PARAMS)
    assert set(result.p_correct) == {c.concept_id for c in g.concepts}
    assert all(0 < p < 1 for p in result.p_correct.values())
    assert set(result.attention["dsa.search"]) == {"prog.arrays", "dsa.stack"}
    assert result.attention["prog.variables"] == {}


def test_an_unseen_concept_starts_at_the_bkt_prior() -> None:
    g = course_graph()
    result = score(model(zero_correction=True), g, {}, [], DEFAULT_PARAMS)
    m = DEFAULT_PARAMS.p_init
    bkt = m * (1 - DEFAULT_PARAMS.p_slip) + (1 - m) * DEFAULT_PARAMS.p_guess
    assert result.p_correct["prog.loops"] == pytest.approx(bkt)


# --- model-ranked recommendations ---------------------------------------------


def small_graph() -> PrerequisiteGraph:
    concepts = [
        Concept("prog.alpha", "Alpha", "prog", "prog.t", "T", 1),
        Concept("prog.beta", "Beta", "prog", "prog.t", "T", 2),
        Concept("prog.gamma", "Gamma", "prog", "prog.t", "T", 3),
    ]
    edges = [Edge("prog.gamma", "prog.alpha", False), Edge("prog.gamma", "prog.beta", False)]
    return PrerequisiteGraph(concepts, edges, "test")


def scores(p: dict[str, float], attention: dict[str, float]) -> Scores:
    return Scores(
        "gat-v2",
        p,
        {"prog.alpha": {}, "prog.beta": {}, "prog.gamma": attention},
    )


def test_the_ready_concept_with_the_highest_readiness_wins() -> None:
    mastery = {"prog.alpha": 0.2, "prog.beta": 0.6}
    assert recommend(small_graph(), "prog", mastery).recommendation.next_concept_id == "prog.alpha"

    s = scores(
        {"prog.alpha": 0.3, "prog.beta": 0.8, "prog.gamma": 0.4},
        {"prog.alpha": 0.5, "prog.beta": 0.5},
    )
    rec = recommend(small_graph(), "prog", mastery, scores=s).recommendation
    assert rec is not None
    assert rec.next_concept_id == "prog.beta"
    assert rec.readiness == 0.8
    assert rec.model_version == "gat-v2"


def test_the_locked_concept_names_attention_times_weakness() -> None:
    mastery = {"prog.alpha": 0.2, "prog.beta": 0.6}
    # Alpha is weaker, but Gamma attends mostly to Beta: 0.1 x 0.8 < 0.6 x 0.4.
    s = scores(
        {"prog.alpha": 0.3, "prog.beta": 0.8, "prog.gamma": 0.4},
        {"prog.alpha": 0.1, "prog.beta": 0.6},
    )
    locked = recommend(small_graph(), "prog", mastery, scores=s).locked
    assert [(lock.concept_id, lock.weak_prerequisite_id) for lock in locked] == [
        ("prog.gamma", "prog.beta")
    ]


def test_a_ready_concept_with_several_prerequisites_names_one_to_review() -> None:
    mastery = {"prog.alpha": 0.9, "prog.beta": 0.8}
    s = scores(
        {"prog.alpha": 0.9, "prog.beta": 0.9, "prog.gamma": 0.7},
        {"prog.alpha": 0.5, "prog.beta": 0.2},
    )
    rec = recommend(small_graph(), "prog", mastery, scores=s).recommendation
    assert rec is not None
    assert rec.next_concept_id == "prog.gamma"
    assert rec.weak_prerequisite_id is None
    assert rec.explanation == (
        "You are ready for Gamma because you have mastered its prerequisites, "
        "and Alpha is the one to review if you get stuck."
    )
    assert rec.explanation.count(".") == 1


def test_a_learner_with_a_model_gets_gat_and_falls_back_on_failure() -> None:
    repo = FakeRepository()
    g = course_graph()
    rec = Learner(repo, model()).plan(USER, g, "prog").recommendation
    assert rec is not None and rec.model_version == "gat-v2"

    broken = model()
    broken.w["W"][:] = np.nan
    rec = Learner(repo, broken).plan(USER, g, "prog").recommendation
    assert rec is not None and rec.model_version == "rules-v1"


def test_the_comparison_group_never_uses_the_model() -> None:
    plan = Learner(FakeRepository(), model()).plan(USER, course_graph(), "prog", fixed=True)
    assert plan.recommendation.model_version == "fixed-order-v1"


def test_the_recommendation_route_reports_the_model_version() -> None:
    app = create_app()
    app.state.graph_runtime = GraphRuntime(
        GraphCache(GraphLoader([Source("core", course_graph())]))
    )
    app.state.learner = Learner(FakeRepository(), model())
    app.state.study = Study(FakeAssessmentRepository(), app.state.learner)
    client = TestClient(app, raise_server_exceptions=False)
    body = client.get(
        f"{PREFIX}/me/recommendation", params={"module": "prog"}, headers=STUDENT
    ).json()
    assert body["recommendation"]["model_version"] == "gat-v2"
    assert 0 < body["recommendation"]["readiness"] < 1


# --- the real exported model (skipped when models/ is empty) --------------------

REAL = SERVICE_ROOT / "models" / "gat-v2.npz"


@pytest.mark.skipif(not REAL.is_file(), reason="gat-v2.npz not copied into models/")
def test_the_exported_gat_v2_loads_and_scores_the_course_graph() -> None:
    default_sha = type(get_settings()).model_fields["model_sha256"].default
    real = load_model(REAL, REAL.with_name("feature_spec.json"), default_sha)
    g = course_graph()
    history = [True, True, False, True]
    records = {"prog.variables": record(0.9, 4), "prog.loops": record(0.5, 2)}
    result = score(real, g, records, history, DEFAULT_PARAMS)
    assert all(0 < p < 1 for p in result.p_correct.values())
    edge_total = sum(result.attention["dsa.search"].values())
    assert 0 < edge_total < 1  # the rest goes to the self-loop
    user = uuid.uuid4()
    rec = Learner(FakeRepository(), real).plan(user, g, "prog").recommendation
    assert rec is not None and rec.model_version == "gat-v2"
