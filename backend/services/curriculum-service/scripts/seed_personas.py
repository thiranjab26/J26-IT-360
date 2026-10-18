"""Seed named demo accounts that can log in, each at a different point of the C1 journey (PP1).

    uv run python -m scripts.seed_personas --dry-run   checks only, nothing written
    uv run python -m scripts.seed_personas             WRITES: accounts (auth API) + curriculum rows
    uv run python -m scripts.seed_personas --reset     WRITES: clears personas' rows, re-seeds
    uv run python -m scripts.seed_personas --remove    WRITES: clears personas' curriculum rows only

SYNTHETIC DATA, NOT EVIDENCE. Names are fictional and student numbers start with IT9999.
Accounts are created through the auth API (gateway + auth-service must be running), so this
script never writes core. Their curriculum rows come from the same code the API runs: scored
tests (DemoStore forces the phase, so the live study window is untouched), the C3 stand-in
practice path, BKT and the GAT planner. Each persona has a fixed seed, so a re-seed is identical.
Deleting the accounts themselves is the leader's call (core.users).
"""

from __future__ import annotations

import argparse
import json
import random
import sys
import urllib.error
import urllib.request
import uuid
from dataclasses import dataclass, field

from sqlalchemy import text

from app.config import get_settings
from app.db.graph_wiring import build_graph_runtime
from app.db.mastery_store import MasteryStore
from app.db.practice_store import PracticeStore
from app.db.session import get_engine
from app.domain.assessment import choose_adaptive
from app.domain.graph import PrerequisiteGraph
from app.domain.learner import Learner
from app.domain.study import Study
from app.integrations.attempts import attempts_relation
from app.main import load_readiness_model
from scripts.seed_demo import DemoStore

PASSWORD = "Demo@PP1-2026"
TABLES = (  # children first; attempts cascade to responses and snapshots
    "explanation_feedback",
    "mastery_evidence",
    "concept_mastery",
    "recommendation",
    "stub_attempt_outcomes",
    "practice_hint",
    "test_attempt",
    "enrolment",
)
PF_BASICS = (
    "prog.java_intro",
    "prog.variables_types",
    "prog.operators_expressions",
    "prog.conditionals",
    "prog.methods",
    "prog.call_flow",
    "prog.classes_objects",
)


@dataclass(frozen=True)
class Journey:
    module: str
    practice: int = 0  # most practice answers, following the live recommendation
    posttest: bool = False


@dataclass(frozen=True)
class Persona:
    key: str
    full_name: str
    email: str
    role: str  # student | lecturer
    story: str
    student_number: str | None = None
    department: str | None = None
    known: tuple[str, ...] = ()  # concepts known before the first pre-test
    seed: int = 0  # picked so the persona's story shows; answers stay random within it
    journeys: tuple[Journey, ...] = field(default=())


PERSONAS = (
    Persona(
        "lecturer",
        "Dr. Ishara Gunasekara",
        "ishara.lecturer@demo.sliit.lk",
        "lecturer",
        "Opens test windows, sees cohort overview and gain, edits questions and the graph.",
        department="Computing (demo)",
    ),
    Persona(
        "new",
        "Amaya Perera",
        "amaya.perera@demo.sliit.lk",
        "student",
        "Brand new: takes a pre-test live.",
        student_number="IT99990001",
    ),
    Persona(
        "pf-beginner",
        "Ravindu Jayasinghe",
        "ravindu.jayasinghe@demo.sliit.lk",
        "student",
        "PF beginner: pre-test and a little practice, recommendation near the graph roots.",
        student_number="IT99990002",
        known=("prog.java_intro",),
        journeys=(Journey("prog", practice=4),),
    ),
    Persona(
        "dsa-blocked",
        "Kasun Fernando",
        "kasun.fernando@demo.sliit.lk",
        "student",
        "Knows PF basics but not loops: every DSA concept is blocked, so the DSA card points "
        "back to a PF prerequisite (Loops) and says which DSA concept builds on it.",
        student_number="IT99990003",
        known=PF_BASICS,
        journeys=(Journey("prog", practice=6), Journey("dsa")),
    ),
    Persona(
        "complete",
        "Nethmi Silva",
        "nethmi.silva@demo.sliit.lk",
        "student",
        "Finished PF (pre, practice, post: gain report), now starting DSA with a 'ready' card.",
        student_number="IT99990004",
        known=(
            *PF_BASICS,
            "prog.loops",
            "prog.nested_loops",
            "prog.arrays",
            "prog.array_iteration",
            "prog.references",
            "prog.code_tracing",
        ),
        journeys=(Journey("prog", practice=30, posttest=True), Journey("dsa", practice=6)),
    ),
)


class Sim:
    """Hidden knowledge of one persona: right 0.9 when known, 0.25 (a guess) when not."""

    def __init__(self, rng: random.Random, graph: PrerequisiteGraph, known: tuple[str, ...]):
        unknown = set(known) - {c.concept_id for c in graph.concepts}
        if unknown:
            raise SystemExit(f"Persona knows concepts missing from the graph: {sorted(unknown)}")
        self.rng = rng
        self.graph = graph
        self.known = {c.concept_id: c.concept_id in known for c in graph.concepts}
        self.tried: dict[str, int] = {}  # tries per practice item; only a first try is evidence

    def answer(self, concept_id: str) -> bool:
        return self.rng.random() < (0.9 if self.known[concept_id] else 0.25)

    def learn(self, concept_id: str) -> None:
        if not self.known[concept_id]:
            ready = all(self.known[p] for p in self.graph.prerequisites_of(concept_id))
            self.known[concept_id] = self.rng.random() < (0.5 if ready else 0.05)


def call_auth(base: str, path: str, body: dict) -> tuple[int, dict]:
    request = urllib.request.Request(
        base.rstrip("/") + "/api/v1/auth" + path,
        data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=20) as response:  # noqa: S310
            return response.status, json.loads(response.read())
    except urllib.error.HTTPError as exc:
        return exc.code, json.loads(exc.read() or b"{}")


def ensure_account(base: str, persona: Persona) -> uuid.UUID:
    """Registers the persona, or logs in if the email already exists."""
    body = {"email": persona.email, "password": PASSWORD, "full_name": persona.full_name}
    if persona.role == "student":
        body["student_number"] = persona.student_number
    else:
        body["department"] = persona.department
    status, data = call_auth(base, f"/register/{persona.role}", body)
    if status == 409:
        status, data = call_auth(base, "/login", {"email": persona.email, "password": PASSWORD})
    if status not in (200, 201):
        raise SystemExit(f"{persona.email}: auth returned {status} {data.get('error', data)}")
    return uuid.UUID(data["user"]["user_id"])


def take_test(study: Study, store, user: uuid.UUID, module: str, kind, sim: Sim) -> float:
    store.forced = kind
    _, items = study.start(user, module, kind)
    answers = {}
    for item in items:  # answer_index is the shown position of the key in this attempt
        if sim.answer(item.concept_id):
            answers[item.item_id] = item.answer_index
        else:
            answers[item.item_id] = sim.rng.choice(
                [i for i in range(len(item.options)) if i != item.answer_index]
            )
    done, _ = study.submit(user, module, kind, answers)
    return done.score_pct or 0.0


def practise(learner: Learner, items, graph, user, j: Journey, sim: Sim) -> int:
    """Follows the live recommendation through the C3 stand-in path. Retries are stored
    and the learner learns from them, but only a first try is BKT evidence."""
    done = 0
    for _ in range(j.practice):
        plan = learner.plan(user, graph, j.module)
        if plan.recommendation is None:
            break
        concept = plan.recommendation.next_concept_id
        bank = [i.item_id for i in items.items(concept)]
        if not bank:
            break
        item_id = min(bank, key=lambda i: sim.tried.get(i, 0))  # least tried, as the page does
        sim.tried[item_id] = sim.tried.get(item_id, 0) + 1
        hints = 1 if sim.rng.random() < 0.1 else 0
        learner.practise(user, concept, item_id, sim.answer(concept), hints)
        sim.learn(concept)
        done += 1
    learner.plan(user, graph, j.module)  # the card the persona sees on login
    return done


def run(study: Study, store, learner: Learner, items, graph, user, p: Persona) -> list[str]:
    """One persona's journeys in order; knowledge carries over from PF to DSA."""
    sim = Sim(random.Random(p.seed), graph, p.known)
    lines = []
    for j in p.journeys:
        pre = take_test(study, store, user, j.module, "pretest", sim)
        done = practise(learner, items, graph, user, j, sim)
        line = f"{j.module} pre {pre:5.1f}  practice {done:>2}"
        if j.posttest:
            line += f"  post {take_test(study, store, user, j.module, 'posttest', sim):5.1f}"
        lines.append(line)
    return lines


def has_data(engine, user: uuid.UUID) -> bool:
    with engine.connect() as connection:
        return connection.execute(
            text("SELECT EXISTS (SELECT 1 FROM curriculum.enrolment WHERE user_id = :u)"),
            {"u": user},
        ).scalar_one()


def clear(engine, users: dict[str, uuid.UUID]) -> None:
    with engine.begin() as connection:
        for table in TABLES:
            deleted = connection.execute(
                text(f"DELETE FROM curriculum.{table} WHERE user_id = ANY(:ids)"),  # noqa: S608
                {"ids": list(users.values())},
            ).rowcount
            print(f"  {table}: {deleted} rows")


def main() -> int:
    parser = argparse.ArgumentParser(description="Seed named, loginable PP1 demo personas.")
    parser.add_argument("--auth-url", default="http://127.0.0.1:8080", help="gateway or auth")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--reset", action="store_true", help="clear the personas' rows first")
    parser.add_argument("--remove", action="store_true", help="clear the personas' rows only")
    args = parser.parse_args()

    settings = get_settings()
    if settings.integration_mode != "stub":
        print("Practice personas need INTEGRATION_MODE=stub.", file=sys.stderr)
        return 1
    engine = get_engine()
    graph = build_graph_runtime(settings).cache.get().graph
    store = DemoStore(engine)
    for module in sorted({j.module for p in PERSONAS for j in p.journeys}):
        for form in ("A", "B"):
            if store.paper_for(module, form) is None:
                print(f"No published paper for {module} form {form}.", file=sys.stderr)
                return 1
    if args.dry_run:
        for p in PERSONAS:
            plan = ", ".join(
                f"{j.module}: pre + {j.practice} practice" + (" + post" if j.posttest else "")
                for j in p.journeys
            )
            print(f"  {p.role:<8} {p.full_name:<22} {p.email:<36} {plan or 'no data'}")
        print("Dry run: graph and papers OK, nothing written.")
        return 0

    users = {p.key: ensure_account(args.auth_url, p) for p in PERSONAS}
    if args.remove or args.reset:
        clear(engine, users)
        if args.remove:
            return 0

    learner = Learner(
        MasteryStore(engine, attempts_relation(settings.integration_mode)),
        load_readiness_model(settings),
    )
    study = Study(store, learner, choose_adaptive)
    practice_items = PracticeStore(engine)
    print(f"Recommender {learner.recommender_version}, graph {graph.version}.")
    for p in PERSONAS:
        user = users[p.key]
        if not p.journeys:
            print(f"  {p.full_name:<22} account ready, no curriculum data")
            continue
        if has_data(engine, user):
            print(f"  {p.full_name:<22} already seeded (use --reset to rebuild)")
            continue
        for line in run(study, store, learner, practice_items, graph, user, p):
            print(f"  {p.full_name:<22} {line}")
    print(f"\nPassword for every persona: {PASSWORD}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
