"""Seed a labelled synthetic cohort so the lecturer view and gain have numbers for the demo.

    uv run python -m scripts.seed_demo --dry-run              plan only, nothing written
    uv run python -m scripts.seed_demo --learners 20          WRITES to Postgres
    uv run python -m scripts.seed_demo --remove               deletes every synthetic row

SYNTHETIC DATA, NOT EVIDENCE. Learners are simulated, never real people. Their ids all
start with de30de30- so they are easy to spot and remove; they exist only in the
curriculum schema (no core.users rows). The real code runs for every step: group and
form order from the study chooser, scored pre/post tests, BKT, and the same planner the
API uses (GAT for the adaptive group, syllabus order for the comparison group).

The simulation: each learner has an ability; each concept starts known with a chance
that falls with depth; a test or practice answer is right with 0.9 when known and 0.25
when not; practising an unknown concept learns it with 0.30 when all its prerequisites
are known, else 0.05. Both groups follow the same rules; only the order differs. Any gap
between groups therefore reflects these assumptions, which is why it is demo data only.

Starting a test locks its paper and synthetic learners take part in group balancing,
so run --remove before the real study and before re-importing a test bank.
"""

from __future__ import annotations

import argparse
import math
import random
import sys
import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy import text

from app.config import get_settings
from app.db.assessment_store import AssessmentStore
from app.db.graph_wiring import build_graph_runtime
from app.db.mastery_store import MasteryStore
from app.db.session import get_engine
from app.domain.assessment import AssessmentError
from app.domain.gat import score as gat_score
from app.domain.graph import PrerequisiteGraph
from app.domain.learner import Learner
from app.domain.mastery import MasteryRecord, Observation, apply
from app.domain.recommend import fixed_order, recommend
from app.domain.study import Study
from app.integrations.attempts import attempts_relation
from app.main import load_readiness_model

PREFIX = "de30de30-"
SEED = 42
TABLES = (  # children first; attempts cascade to responses and snapshots
    "mastery_evidence",
    "concept_mastery",
    "recommendation",
    "stub_attempt_outcomes",
    "practice_hint",
    "test_attempt",
    "enrolment",
)


def learner_id(n: int) -> uuid.UUID:
    return uuid.UUID(f"{PREFIX}0000-4000-8000-{n:012d}")


class DemoStore(AssessmentStore):
    """The real store, except the phase is forced so the live study window is untouched."""

    forced = "closed"

    def phase(self, module_id: str):  # type: ignore[override]
        return self.forced


class Sim:
    """Hidden knowledge of one simulated learner."""

    def __init__(self, rng: random.Random, graph: PrerequisiteGraph) -> None:
        self.rng = rng
        self.graph = graph
        ability = rng.gauss(0, 1)
        self.known = {
            c.concept_id: rng.random() < _sigmoid(0.6 * ability - 0.25 * graph.depth(c.concept_id))
            for c in graph.concepts
        }

    def answer(self, concept_id: str) -> bool:
        return self.rng.random() < (0.9 if self.known[concept_id] else 0.25)

    def practise(self, concept_id: str) -> tuple[bool, int]:
        hints = 1 if self.rng.random() < 0.1 else 0
        correct = self.answer(concept_id)
        if not self.known[concept_id]:
            ready = all(self.known[p] for p in self.graph.prerequisites_of(concept_id))
            self.known[concept_id] = self.rng.random() < (0.30 if ready else 0.05)
        return correct, hints


def _sigmoid(x: float) -> float:
    return 1 / (1 + math.exp(-x))


def take_test(
    study: Study, store: DemoStore, user: uuid.UUID, module: str, kind, sim: Sim
) -> float:
    store.forced = kind
    attempt, items = study.start(user, module, kind)
    # Items arrive shuffled for this attempt; answer_index is the shown position of the key.
    answers = {}
    for item in items:
        if sim.answer(item.concept_id):
            answers[item.item_id] = item.answer_index
        else:
            wrong = [i for i in range(len(item.options)) if i != item.answer_index]
            answers[item.item_id] = sim.rng.choice(wrong)
    done, _ = study.submit(user, module, kind, answers)
    return done.score_pct or 0.0


def practise(
    learner: Learner,
    graph: PrerequisiteGraph,
    module: str,
    user: uuid.UUID,
    group: str,
    sim: Sim,
    steps: int,
) -> int:
    """Plans in memory with the API's planner, then stores the answers as practice evidence."""
    repo = learner.repository
    records: dict[str, MasteryRecord] = dict(repo.mastery(user))
    history = list(repo.history(user))
    start = datetime.now(UTC)
    observations: list[Observation] = []
    for k in range(steps):
        mastery = {cid: r.score for cid, r in records.items()}
        if group == "comparison":
            plan = fixed_order(graph, module, mastery)
        else:
            scores = (
                gat_score(learner.model, graph, records, history, learner.params)
                if learner.model
                else None
            )
            plan = recommend(graph, module, mastery, scores=scores)
        if plan.recommendation is None:
            break
        concept = plan.recommendation.next_concept_id
        correct, hints = sim.practise(concept)
        obs = Observation(
            concept_id=concept,
            item_id=f"sim-{concept}-{k:03d}",
            source="practice",
            source_ref=f"{user}|sim-{k:03d}",
            correct_raw=correct,
            hints_used=hints,
            observed_at=start + timedelta(seconds=k),
        )
        _, records[concept] = apply(records.get(concept), obs, learner.params)
        history.append(obs.correct)
        observations.append(obs)
    learner.record(user, observations)
    learner.plan(
        user, graph, module, fixed=group == "comparison"
    )  # store the latest recommendation
    return len(observations)


def remove(engine) -> None:
    with engine.begin() as connection:
        for table in TABLES:
            deleted = connection.execute(
                text(f"DELETE FROM curriculum.{table} WHERE user_id::text LIKE :prefix"),  # noqa: S608
                {"prefix": PREFIX + "%"},
            ).rowcount
            print(f"  {table}: {deleted} rows")
    print("Synthetic cohort removed.")


def main() -> int:
    parser = argparse.ArgumentParser(description="Seed or remove the labelled synthetic cohort.")
    parser.add_argument("--module", default="dsa")
    parser.add_argument("--learners", type=int, default=20)
    parser.add_argument("--steps", type=int, default=20, help="practice answers per learner")
    parser.add_argument("--dry-run", action="store_true", help="plan only, write nothing")
    parser.add_argument("--remove", action="store_true", help="delete every synthetic row")
    args = parser.parse_args()

    settings = get_settings()
    engine = get_engine()
    if args.remove:
        if args.dry_run:
            print(f"Dry run: would delete rows whose user_id starts with {PREFIX}.")
            return 0
        remove(engine)
        return 0

    graph = build_graph_runtime(settings).cache.get().graph
    store = DemoStore(engine)
    learner = Learner(
        MasteryStore(engine, attempts_relation(settings.integration_mode)),
        load_readiness_model(settings),
    )
    study = Study(store, learner)
    print(
        f"Module {args.module}: {args.learners} synthetic learners, {args.steps} practice answers "
        f"each, recommender {learner.recommender_version}."
    )
    for form in ("A", "B"):
        if store.paper_for(args.module, form) is None:
            print(
                f"No published paper for {args.module} form {form}; import it first.",
                file=sys.stderr,
            )
            return 1
    if args.dry_run:
        print("Dry run: nothing written.")
        return 0

    rng = random.Random(SEED)
    for n in range(1, args.learners + 1):
        user = learner_id(n)
        sim = Sim(random.Random(rng.random()), graph)
        try:
            pre = take_test(study, store, user, args.module, "pretest", sim)
            group = study.group_of(user, args.module) or "adaptive"
            answered = practise(learner, graph, args.module, user, group, sim, args.steps)
            post = take_test(study, store, user, args.module, "posttest", sim)
        except AssessmentError as exc:
            print(f"  learner {n}: skipped ({exc.code})")
            continue
        print(
            f"  learner {n:>2} {group:<10} pre {pre:5.1f}  practice {answered:>2}  post {post:5.1f}"
        )
    print("Done. Remove with: uv run python -m scripts.seed_demo --remove")
    return 0


if __name__ == "__main__":
    sys.exit(main())
