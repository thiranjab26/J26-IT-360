"""Checking a practical before a lecturer sees it, and the lecturer's draft, approve and reject.

A draft is a statement and a reference solution. Nothing about it is trusted until it has been
run. `validate` does that, in an order that puts the cheap and the dangerous first:

    format      the pieces a runnable program needs are there
    safe_code   no file, network, process or reflection APIs (the dev runner is not a sandbox)
    compiles    the reference solution compiles
    samples     it prints exactly what the statement says it prints
    hidden      extra tests exist (inputs may come from a model; outputs come from the solution)
    stable      running it again gives the same answers

A failed check blocks approval. A warning does not, but the lecturer sees it.

Approval REPLACES: the practical that filled the same slot is retired, and kept (an authored one
is copied into the database first), so what students saw before is never lost. Student credit
and XP follow the slot, so nobody repeats a practical or is paid for it twice.

No FastAPI imports.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any

from app.llm.providers import LLMProvider
from app.models.authoring import (
    AuthorDetailOut,
    AuthorItemOut,
    AuthorOverviewOut,
    BulkResultOut,
    CheckOut,
    TestDetailOut,
)
from app.practicals.catalog import AssessmentCatalog
from app.practicals.items import (
    APPROVED,
    AUTHORED,
    DRAFT,
    GENERATED,
    MANUAL,
    REJECTED,
    RETIRED,
    AssessmentStore,
    Item,
    new_question_id,
    now,
)
from app.practicals.repository import PracticalRepository
from app.practicals.runner import CodeRunner, RunnerUnavailable
from app.practicals.service import practical_id
from app.practicals.tests_builder import TestCase, build_tests, same_output
from app.sessions.catalog import Course
from app.sessions.service import SessionProblem

if TYPE_CHECKING:  # generation imports this module, so the type is only named here
    from app.practicals.generation import DraftGenerator

MAX_BATCH = 6
MAX_STATEMENT = 8_000
MAX_SOLUTION = 12_000
LEVELS = (4, 5)

DANGEROUS = re.compile(
    r"\b(?:Runtime\s*\.\s*getRuntime|ProcessBuilder|ClassLoader|Class\s*\.\s*forName"
    r"|System\s*\.\s*(?:load|loadLibrary|setSecurityManager|setIn|setOut|setErr)"
    r"|java\s*\.\s*(?:io\s*\.\s*File|nio\s*\.\s*file|net|lang\s*\.\s*reflect)"
    r"|FileReader|FileWriter|FileInputStream|FileOutputStream|Files|Paths|Socket|HttpClient)\b"
)


def check(name: str, status: str, detail: str = "") -> dict[str, str]:
    return {"name": name, "status": status, "detail": detail}


@dataclass(frozen=True)
class GenerationPlan:
    """What is needed to ask for one draft, and where it will go."""

    concept_id: str
    target_pid: str
    slot_id: str
    number: int
    level: int
    existing: list[tuple[str, str]]


@dataclass
class Validation:
    tests: list[TestCase] = field(default_factory=list)
    checks: list[dict[str, str]] = field(default_factory=list)

    @property
    def failed(self) -> bool:
        return any(c["status"] == "fail" for c in self.checks)


def validate(
    statement: str,
    reference: str,
    runner: CodeRunner,
    provider: LLMProvider | None = None,
) -> Validation:
    result = Validation()
    add = result.checks.append

    problems = []
    if len(statement.strip()) < 30:
        problems.append("the statement is too short to be a task")
    if len(statement) > MAX_STATEMENT or len(reference) > MAX_SOLUTION:
        problems.append("the statement or the solution is too long")
    if "public class Main" not in reference or "static void main" not in reference:
        problems.append("the solution must be a Java program: public class Main with a main method")
    add(check("format", "fail" if problems else "pass", "; ".join(problems)))

    danger = DANGEROUS.search(reference)
    add(
        check(
            "safe_code",
            "fail" if danger else "pass",
            f"the solution uses {danger.group(0)!r}, which practicals do not allow"
            if danger
            else "",
        )
    )
    if result.failed:
        return result  # never run code that failed these

    built = build_tests(statement, reference, runner, provider)
    notes = built.notes

    compile_note = next((n for n in notes if n.startswith("the reference solution does not")), None)
    add(check("compiles", "fail" if compile_note else "pass", compile_note or ""))
    if compile_note:
        return result

    mismatches = [n for n in notes if n.startswith("sample ")]
    no_sample = any(n.startswith("the statement shows no sample") for n in notes)
    if mismatches:
        add(check("samples", "fail", " ".join(mismatches)))
    elif no_sample:
        add(check("samples", "warn", "the statement shows no sample input and output"))
    else:
        add(check("samples", "pass"))

    hidden = sum(1 for t in built.tests if not t.visible)
    if not built.tests:
        add(check("hidden", "fail", "no tests could be made"))
    elif hidden == 0:
        add(check("hidden", "warn", "only the sample test exists, so there are no hidden tests"))
    else:
        add(check("hidden", "pass", f"{hidden} hidden tests"))
    if not built.tests or mismatches:
        return result

    again = runner.run_batch(reference, [t.stdin for t in built.tests])
    unstable = [
        n
        for n, (t, r) in enumerate(zip(built.tests, again.runs, strict=False), 1)
        if r.status != "ok" or not same_output(r.stdout, t.expected)
    ]
    add(
        check(
            "stable",
            "fail" if unstable else "pass",
            f"tests {unstable} gave a different answer when run a second time" if unstable else "",
        )
    )
    if not unstable:
        result.tests = built.tests
    return result


class AuthoringService:
    def __init__(
        self,
        store: AssessmentStore,
        repo: PracticalRepository,
        course: Course,
        runner: CodeRunner | None,
        provider: LLMProvider | None = None,
    ) -> None:
        self.store = store
        self.repo = repo
        self.course = course
        self.runner = runner
        self.provider = provider

    # ---------------------------------------------------------------- reading
    def catalog(self) -> AssessmentCatalog:
        return AssessmentCatalog(self.course, self.store.all())

    def overview(self, concept_id: str | None = None) -> AuthorOverviewOut:
        items = self.store.all()
        catalog = AssessmentCatalog(self.course, items)
        counts = self.repo.test_counts()

        def keep(cid: str) -> bool:
            return concept_id in (None, cid)

        current = [
            self._out(catalog, self._item_of(catalog, e), counts)
            for e in catalog.entries()
            if keep(e.question.concept_id)
        ]
        drafts = [
            self._out(catalog, i, counts) for i in items if i.status == DRAFT and keep(i.concept_id)
        ]
        history = [
            self._out(catalog, i, counts)
            for i in items
            if i.status in (RETIRED, REJECTED) and keep(i.concept_id)
        ]
        return AuthorOverviewOut(current=current, drafts=drafts, history=history)

    def detail(self, pid: str) -> AuthorDetailOut:
        catalog = self.catalog()
        qid = _qid(pid)
        item = self.store.get(qid)
        if item is None:
            entry = catalog.authored(qid)
            if entry is None:
                raise SessionProblem("not_found", "practical_not_found", "No such practical.")
            item = self._item_of(catalog, entry)
        counts = self.repo.test_counts()
        chain = [
            self._out(catalog, i, counts)
            for i in self.store.all()
            if i.slot_id == item.slot_id and i.question_id != item.question_id and i.status != DRAFT
        ]
        return AuthorDetailOut(
            **self._out(catalog, item, counts).model_dump(),
            tests=[
                TestDetailOut(
                    stdin=t.stdin, expected=t.expected, visible=t.visible, source=t.source
                )
                for t in self.repo.tests(item.question_id)
            ],
            slot_history=chain,
        )

    # ---------------------------------------------------------------- drafting
    def create_draft(
        self,
        lecturer_id: str,
        concept_id: str,
        statement: str,
        reference: str,
        level: int,
        replaces_pid: str | None,
        suggest_tests: bool = True,
    ) -> AuthorItemOut:
        catalog = self.catalog()
        if not self.course.has_concept(concept_id):
            raise SessionProblem("invalid", "unknown_concept", f"No such concept: {concept_id}.")
        if level not in LEVELS:
            raise SessionProblem("invalid", "bad_level", "A practical is level 4 or 5.")

        question_id = new_question_id(concept_id)
        if replaces_pid:
            target = catalog.entry(_qid(replaces_pid))
            if target is None or target.question.concept_id != concept_id:
                raise SessionProblem(
                    "invalid", "bad_target", "That practical is not one of this concept's."
                )
            slot, number = catalog.slot_of(target.question.question_id), target.question.number
        else:
            slot = question_id
            numbers = [
                e.question.number for e in catalog.entries() if e.question.concept_id == concept_id
            ]
            number = max(numbers, default=0) + 1

        validation = self._validate(statement, reference, suggest_tests)
        item = Item(
            question_id=question_id,
            slot_id=slot,
            concept_id=concept_id,
            origin=MANUAL,
            status=DRAFT,
            number=number,
            level=level,
            statement=statement,
            reference_solution=reference,
            checks=validation.checks,
            created_by=lecturer_id,
        )
        self.store.add(item)
        self.repo.replace_tests(question_id, validation.tests)
        return self._out(catalog, item, {question_id: len(validation.tests)})

    def edit_draft(
        self,
        pid: str,
        statement: str | None,
        reference: str | None,
        level: int | None,
        suggest_tests: bool = True,
    ) -> AuthorItemOut:
        item = self._draft(pid)
        if level is not None and level not in LEVELS:
            raise SessionProblem("invalid", "bad_level", "A practical is level 4 or 5.")
        statement = item.statement if statement is None else statement
        reference = item.reference_solution if reference is None else reference
        validation = self._validate(statement, reference, suggest_tests)
        self.store.change(
            item.question_id,
            statement=statement,
            reference_solution=reference,
            level=item.level if level is None else level,
            checks=validation.checks,
        )
        self.repo.replace_tests(item.question_id, validation.tests)
        updated = self.store.get(item.question_id)
        assert updated is not None
        return self._out(self.catalog(), updated, {item.question_id: len(validation.tests)})

    # ---------------------------------------------------------------- generating
    def plan_targets(
        self, concept_id: str, count: int, replaces: list[str] | None = None
    ) -> list[str]:
        """Which practical each new draft is meant to replace. Named ones are used as given;
        otherwise the concept's current practicals are taken in order, and reused if more
        drafts are wanted than there are places."""
        if not self.course.has_concept(concept_id):
            raise SessionProblem("invalid", "unknown_concept", f"No such concept: {concept_id}.")
        catalog = self.catalog()
        if replaces:
            for pid in replaces:
                entry = catalog.entry(_qid(pid))
                if entry is None or entry.question.concept_id != concept_id:
                    raise SessionProblem(
                        "invalid", "bad_target", "That practical is not one of this concept's."
                    )
            return list(replaces)[:MAX_BATCH]
        places = [
            practical_id(e.question.question_id)
            for e in catalog.entries()
            if e.question.concept_id == concept_id
        ]
        if not places:
            raise SessionProblem(
                "invalid", "no_practicals", "This concept has no practical to replace."
            )
        if not 1 <= count <= MAX_BATCH:
            raise SessionProblem(
                "invalid", "bad_count", f"Ask for between 1 and {MAX_BATCH} drafts at a time."
            )
        return [places[i % len(places)] for i in range(count)]

    def prepare_generation(self, concept_id: str, target_pid: str) -> GenerationPlan:
        """Everything the model needs to know about one place, read from the database. Kept
        apart from the model call so a long call never holds a database connection open."""
        catalog = self.catalog()
        target = catalog.entry(_qid(target_pid))
        if target is None or target.question.concept_id != concept_id:
            raise SessionProblem(
                "invalid", "bad_target", "That practical is not one of this concept's."
            )
        existing = [
            (practical_id(e.question.question_id), e.question.stem)
            for e in catalog.entries()
            if e.question.concept_id == concept_id
        ] + [
            (practical_id(i.question_id), i.statement)
            for i in self.store.all()
            if i.concept_id == concept_id and i.status == DRAFT
        ]
        level = target.question.level if target.question.level in LEVELS else LEVELS[0]
        return GenerationPlan(
            concept_id=concept_id,
            target_pid=target_pid,
            slot_id=catalog.slot_of(target.question.question_id),
            number=target.question.number,
            level=level,
            existing=existing,
        )

    def save_generated(
        self, lecturer_id: str | None, plan: GenerationPlan, draft, job_id: str | None = None
    ) -> AuthorItemOut:
        """Keep a generated draft for review, with the model's own record of how it was made."""
        question_id = new_question_id(plan.concept_id)
        item = Item(
            question_id=question_id,
            slot_id=plan.slot_id,
            concept_id=plan.concept_id,
            origin=GENERATED,
            status=DRAFT,
            number=plan.number,
            level=plan.level,
            statement=draft.statement,
            reference_solution=draft.reference_solution,
            checks=draft.checks,
            generation={**draft.generation, "job_id": job_id},
            created_by=lecturer_id,
        )
        self.store.add(item)
        self.repo.replace_tests(question_id, draft.tests)
        return self._out(self.catalog(), item, {question_id: len(draft.tests)})

    def generate_one(
        self,
        lecturer_id: str | None,
        generator: DraftGenerator,
        concept_id: str,
        target_pid: str,
        hint: str | None,
        avoid: list[str],
        job_id: str | None = None,
    ) -> AuthorItemOut:
        """Ask the model for one draft aimed at `target_pid` and save it for review."""
        plan = self.prepare_generation(concept_id, target_pid)
        draft = generator.generate(concept_id, plan.level, plan.existing, hint, avoid)
        return self.save_generated(lecturer_id, plan, draft, job_id)

    def approve_many(
        self, lecturer_id: str, pids: list[str], note: str | None
    ) -> list[BulkResultOut]:
        return self._each(pids, lambda pid: self.approve(lecturer_id, pid, note))

    def reject_many(
        self, lecturer_id: str, pids: list[str], note: str | None
    ) -> list[BulkResultOut]:
        return self._each(pids, lambda pid: self.reject(lecturer_id, pid, note))

    @staticmethod
    def _each(pids: list[str], action) -> list[BulkResultOut]:
        """Apply `action` to each, so one that cannot be done does not stop the others."""
        results = []
        for pid in dict.fromkeys(pids):  # each once, in the order given
            try:
                action(pid)
                results.append(BulkResultOut(practical_id=pid, ok=True))
            except SessionProblem as problem:
                results.append(
                    BulkResultOut(
                        practical_id=pid, ok=False, code=problem.code, message=problem.message
                    )
                )
        return results

    # ---------------------------------------------------------------- reviewing
    def approve(self, lecturer_id: str, pid: str, note: str | None) -> AuthorItemOut:
        item = self._draft(pid)
        if item.blocked:
            raise SessionProblem(
                "conflict", "checks_failed", "Fix the failed checks first, then approve."
            )
        if not self.repo.tests(item.question_id):
            raise SessionProblem("conflict", "no_tests", "This draft has no tests to mark with.")

        catalog = self.catalog()
        current = catalog.current_in(item.slot_id)
        replaced = None
        if current is not None:
            replaced = current.question.question_id
            self._retire(catalog, current, lecturer_id, replaced_by=item.question_id)
        # Retire first, approve second: the database allows one approved item per slot.
        self.store.change(
            item.question_id,
            status=APPROVED,
            replaces_question_id=replaced,
            reviewed_by=lecturer_id,
            reviewed_at=now(),
            review_note=note,
        )
        approved = self.store.get(item.question_id)
        assert approved is not None
        return self._out(self.catalog(), approved, self.repo.test_counts())

    def reject(self, lecturer_id: str, pid: str, note: str | None) -> AuthorItemOut:
        item = self._draft(pid)
        self.store.change(
            item.question_id,
            status=REJECTED,
            reviewed_by=lecturer_id,
            reviewed_at=now(),
            review_note=note,
        )
        rejected = self.store.get(item.question_id)
        assert rejected is not None
        return self._out(self.catalog(), rejected, self.repo.test_counts())

    def restore(self, lecturer_id: str, pid: str) -> AuthorItemOut:
        """Bring a replaced practical back, replacing whatever fills its slot now."""
        item = self.store.get(_qid(pid))
        if item is None or item.status != RETIRED:
            raise SessionProblem(
                "conflict", "not_retired", "Only a replaced practical can be restored."
            )
        catalog = self.catalog()
        current = catalog.current_in(item.slot_id)
        if current is not None:
            self._retire(catalog, current, lecturer_id, replaced_by=item.question_id)
        self.store.change(
            item.question_id,
            status=APPROVED,
            replaced_by_question_id=None,
            retired_at=None,
            retired_by=None,
            reviewed_by=lecturer_id,
            reviewed_at=now(),
        )
        restored = self.store.get(item.question_id)
        assert restored is not None
        return self._out(self.catalog(), restored, self.repo.test_counts())

    # ---------------------------------------------------------------- helpers
    def _validate(self, statement: str, reference: str, suggest_tests: bool) -> Validation:
        if self.runner is None:
            raise SessionProblem(
                "unavailable", "runner_unavailable", "Running code is switched off on this server."
            )
        try:
            return validate(
                statement, reference, self.runner, self.provider if suggest_tests else None
            )
        except RunnerUnavailable as exc:
            raise SessionProblem("unavailable", "runner_unavailable", str(exc)) from exc

    def _draft(self, pid: str) -> Item:
        item = self.store.get(_qid(pid))
        if item is None:
            raise SessionProblem("not_found", "practical_not_found", "No such draft.")
        if item.status != DRAFT:
            raise SessionProblem("conflict", "not_a_draft", "Only a draft can be changed.")
        return item

    def _retire(
        self, catalog: AssessmentCatalog, entry, lecturer_id: str, replaced_by: str
    ) -> None:
        q = entry.question
        stamp: dict[str, Any] = {
            "status": RETIRED,
            "replaced_by_question_id": replaced_by,
            "retired_at": now(),
            "retired_by": lecturer_id,
        }
        if self.store.get(q.question_id) is not None:
            self.store.change(q.question_id, **stamp)
            return
        # An authored practical is copied in before it goes, so the database holds the history.
        self.store.add(
            Item(
                question_id=q.question_id,
                slot_id=q.question_id,
                concept_id=q.concept_id,
                origin=AUTHORED,
                status=RETIRED,
                number=q.number,
                level=q.level,
                statement=q.stem,
                reference_solution=entry.key.reference_solution or "",
                replaced_by_question_id=replaced_by,
                retired_at=stamp["retired_at"],
                retired_by=lecturer_id,
            )
        )

    @staticmethod
    def _item_of(catalog: AssessmentCatalog, entry) -> Item:
        """The item behind a current practical: its row, or else the authored question."""
        q = entry.question
        row = catalog.item(q.question_id)
        if row is not None:
            return row
        return Item(
            question_id=q.question_id,
            slot_id=q.question_id,
            concept_id=q.concept_id,
            origin=AUTHORED,
            status=APPROVED,
            number=q.number,
            level=q.level,
            statement=q.stem,
            reference_solution=entry.key.reference_solution or "",
        )

    def _out(self, catalog: AssessmentCatalog, item: Item, counts: dict[str, int]) -> AuthorItemOut:
        concept_title = self.course.titles.get(item.concept_id, item.concept_id)
        return AuthorItemOut(
            practical_id=practical_id(item.question_id),
            slot_id=practical_id(item.slot_id),
            concept_id=item.concept_id,
            concept_title=concept_title,
            title=f"{concept_title}: practical {item.number}",
            number=item.number,
            level=item.level,
            origin=item.origin,
            status=item.status,
            statement=item.statement,
            reference_solution=item.reference_solution,
            checks=[CheckOut(**c) for c in item.checks],
            tests_total=counts.get(item.question_id, 0),
            replaces=practical_id(item.replaces_question_id) if item.replaces_question_id else None,
            replaced_by=practical_id(item.replaced_by_question_id)
            if item.replaced_by_question_id
            else None,
            created_by=item.created_by,
            created_at=item.created_at,
            reviewed_by=item.reviewed_by,
            reviewed_at=item.reviewed_at,
            review_note=item.review_note,
            can_approve=item.status == DRAFT and not item.blocked,
        )


def _qid(pid: str) -> str:
    return pid.replace("~", "#")
