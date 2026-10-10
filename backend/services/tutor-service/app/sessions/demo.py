"""Play a guided session in the terminal, on the real course content.

    uv run python -m app.sessions.demo prog.loops                     # you play it
    uv run python -m app.sessions.demo prog.loops --auto              # a scripted student
    uv run python -m app.sessions.demo prog.loops --auto --misses 1  # one miss per gating question
    uv run python -m app.sessions.demo prog.loops --auto --misses 3  # fails: `struggling`

This is a way to SEE the engine work before there is a screen for it. It uses the real
session state machine, plan builder, question bank, marking, XP, mastery estimate and
unlock rules. What it cannot do is write the teaching: that needs the language model.
Where the tutor would explain, it prints the authored course passage instead, and where
it would give a hint it says so. Nothing here touches the database or the network.
"""

from __future__ import annotations

import argparse
import random
import sys
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from typing import Protocol

from app.config import get_settings
from app.content.chunker import chunk_unit
from app.content.loader import load_content
from app.content.models import Chunk, Unit
from app.domain.questions import (
    KIND_MCQ,
    AnswerKey,
    BankEntry,
    Question,
    build_question_bank,
    shuffled,
)
from app.gamification.mastery import CheckpointResult, estimate
from app.gamification.rules import Policy, UnlockRules, module_status, next_concept
from app.gamification.xp import xp_for_checkpoint
from app.grading.deterministic import grade
from app.sessions.plan import build_plan
from app.sessions.state_machine import (
    Answer,
    AskAgain,
    AskCheckpoint,
    Continue,
    End,
    EndedByStudent,
    ExitReason,
    MasteryReached,
    Phase,
    Reteach,
    Rules,
    SessionState,
    ShowFeedback,
    ShowHook,
    ShowTeach,
    start,
    step,
)

RULE = "-" * 72


class Student(Protocol):
    def read(self, prompt: str) -> bool:
        """Show that the tutor is waiting. False means the student walked away."""
        ...

    def answer(self, question: Question, gating: bool, attempt: int) -> str | None:
        """The student's answer, or None if they walked away."""
        ...


class Interactive:
    def read(self, prompt: str) -> bool:
        try:
            return input(f"\n  [{prompt}, or q to quit] ").strip().lower() != "q"
        except EOFError:
            return False

    def answer(self, question: Question, gating: bool, attempt: int) -> str | None:
        try:
            if question.kind == KIND_MCQ:
                return input("\n  Your answer (A, B, C or D, q to quit): ").strip() or " "
            print("\n  Type what it prints, one line per output line. Blank line to finish.")
            lines: list[str] = []
            while True:
                line = input("  > ")
                if not line.strip():
                    break
                lines.append(line)
            return "\n".join(lines) if lines else " "
        except EOFError:
            return None


@dataclass
class Scripted:
    """A student who gives the right answer after `misses` wrong ones on each gating question."""

    entries: dict[str, BankEntry]
    shown: dict[str, tuple[Question, str | None]] = field(default_factory=dict)
    misses: int = 0

    def read(self, prompt: str) -> bool:
        return True

    def answer(self, question: Question, gating: bool, attempt: int) -> str | None:
        key = self.entries[question.question_id].key
        if gating and attempt <= self.misses:
            return "definitely not the answer"
        correct = self.shown[question.question_id][1]
        return correct if correct is not None else (key.expected_output or "")


@dataclass
class Summary:
    exit: ExitReason
    xp: int
    gating_results: list[CheckpointResult]
    mastery: float | None
    passed_gating: int
    gating_total: int


def play(
    *,
    concept_id: str,
    units: list[Unit],
    chunks: list[Chunk],
    student: Student,
    rng: random.Random,
    out: Callable[[str], None] = print,
    session_rules: Rules | None = None,
    unlock_rules: UnlockRules | None = None,
) -> Summary:
    unlock_rules = unlock_rules or UnlockRules()
    bank = build_question_bank(chunks)
    text = {c.chunk_id: c.text for c in chunks}
    unit = next(u for u in units if u.concept_id == concept_id)
    theory = [
        c.chunk_id for c in chunks if c.concept_id == concept_id and c.section_type == "theory"
    ]

    plan = build_plan(concept_id=concept_id, teach_refs=theory, bank=bank, rng=rng)
    clock = [datetime(2026, 10, 10, 9, 0, tzinfo=UTC)]

    def now() -> datetime:
        clock[0] += timedelta(minutes=1)
        return clock[0]

    out(
        f"\n{RULE}\nSESSION on {unit.title}  ({len(plan)} steps; "
        f"{sum(1 for s in plan if s.gating)} gating checkpoints)\n{RULE}\n"
        "(The demo lets you start on any concept. In the product a concept whose prerequisites "
        "are not yet mastered would be locked.)"
    )

    transition = start(
        session_id="demo",
        user_id="you",
        concept_id=concept_id,
        steps=plan,
        now=now(),
        rules=session_rules,
    )
    state: SessionState = transition.state
    directives = list(transition.directives)

    xp = 0
    results: list[CheckpointResult] = []
    shown: dict[str, tuple[Question, str | None]] = getattr(student, "shown", {})
    # The question as shown (options shuffled) with the answer key adjusted to match it.
    current: tuple[Question, BankEntry, AnswerKey] | None = None

    while True:
        # ---- show what the engine asked for
        for directive in directives:
            if isinstance(directive, ShowHook):
                objectives = text.get(f"{concept_id}#objectives-01", "")
                out(
                    f"\n[HOOK] The tutor would open with a short, concrete situation. "
                    f"For now, what you will be able to do:\n\n{objectives}"
                )
            elif isinstance(directive, ShowTeach):
                out(
                    f"\n[TEACH] (the tutor would explain this in its own words; "
                    f"here is the course passage)\n\n{text[directive.ref]}"
                )
            elif isinstance(directive, AskCheckpoint):
                entry = bank[directive.ref]
                question, key = shuffled(entry.question, entry.key, rng)
                current = (question, entry, key)
                shown[question.question_id] = (question, key.correct_option)
                kind = "CHECKPOINT (gating)" if directive.gating else "PULSE CHECK (never blocks)"
                tries = (
                    f", try {directive.attempt} of {state.rules.max_attempts}"
                    if directive.gating
                    else ""
                )
                hint = "  [the tutor would add a hint here]" if directive.hint else ""
                out(f"\n[{kind}{tries}]{hint}\n\n{question.stem}")
                for option in question.options:
                    out(f"   {option.letter}. {option.text}")
            elif isinstance(directive, AskAgain):
                out("\n  I could not read that as an answer. Nothing was counted. Try again.")
            elif isinstance(directive, ShowFeedback):
                out(
                    f"\n[FEEDBACK] {'Correct.' if directive.outcome == 'correct' else 'Not quite.'}"
                )
            elif isinstance(directive, Reteach):
                out(
                    "\n[RE-TEACH] Two misses: the tutor would now explain the underlying idea "
                    "again before your next try."
                )
            elif isinstance(directive, End):
                out(f"\n{RULE}\nSESSION ENDED: {directive.reason.value}\n{RULE}")
        directives = []

        if state.is_over:
            break

        # ---- what the student does next
        phase = state.phase
        if phase in (Phase.HOOK, Phase.TEACH, Phase.FEEDBACK, Phase.RETEACH):
            if not student.read("press Enter to continue"):
                transition = step(state, EndedByStudent(), now())
            else:
                transition = step(state, Continue(), now())
        else:  # an open checkpoint
            assert current is not None
            question, entry, shown_key = current
            gating = state.current.gating
            given = student.answer(question, gating, state.attempts + 1)
            if given is None:
                transition = step(state, EndedByStudent(), now())
            else:
                verdict = grade(question, shown_key, given)
                if verdict.outcome == "correct":
                    attempt = state.attempts + 1 if gating else 1
                    earned = xp_for_checkpoint(
                        gating=gating, passed=True, attempts_used=attempt, hints_used=attempt - 1
                    )
                    xp += earned
                    out(f"\n  +{earned} XP")
                    if entry.key.explanation:
                        out(f"  Why: {entry.key.explanation}")
                    if gating:
                        results.append(CheckpointResult(True, attempt))
                elif verdict.outcome == "wrong" and not gating and entry.key.explanation:
                    out(f"  The answer was {shown_key.correct_option}. {entry.key.explanation}")
                transition = step(state, Answer(verdict.outcome), now())

                # Mastery is checked after each gating pass; if it is high enough the
                # session may end early, but only if something is left to skip.
                if gating and verdict.outcome == "correct":
                    level = estimate(results)
                    if level is not None and level >= unlock_rules.early_exit_mastery:
                        early = step(transition.state, MasteryReached(), now())
                        if early.state.is_over:
                            transition = type(transition)(
                                early.state, (*transition.directives, *early.directives)
                            )

                if transition.state.exit is ExitReason.STRUGGLING:
                    results.append(CheckpointResult(False, state.rules.max_attempts))

        state = transition.state
        directives = list(transition.directives)

    mastery = estimate(results)
    summary = Summary(
        exit=state.exit or ExitReason.COMPLETED,
        xp=xp,
        gating_results=results,
        mastery=mastery,
        passed_gating=state.gating_done,
        gating_total=state.gating_total,
    )
    _report(summary, concept_id, units, unlock_rules, out)
    return summary


def _report(
    summary: Summary,
    concept_id: str,
    units: list[Unit],
    rules: UnlockRules,
    out: Callable[[str], None],
) -> None:
    concepts = [u for u in sorted(units, key=lambda u: u.sequence) if u.concept_id]
    order = [u.concept_id for u in concepts]
    graph = {u.concept_id: list(u.all_prerequisites) for u in concepts}
    mastery = {concept_id: summary.mastery}
    names = {u.concept_id: u.title.split(". ", 1)[-1] for u in concepts}

    out(f"\nResult: {summary.exit.value}")
    out(f"XP earned: {summary.xp}")
    out(f"Gating checkpoints passed: {summary.passed_gating} of {summary.gating_total}")
    level = (
        "not enough evidence yet (needs 2 gating results)"
        if summary.mastery is None
        else f"{summary.mastery:.0%}"
    )
    out(f"Mastery estimate for this concept (stand-in for C1's): {level}")

    out("\nWhat this opens for you, under each of the two conditions in the study:")
    for policy in (Policy.MASTERY_GATED, Policy.POINTS_ONLY):
        statuses = module_status(
            order,
            prerequisites=graph,
            mastery=mastery,
            total_xp=summary.xp,
            policy=policy,
            rules=rules,
        )
        opened = [names[s.concept_id] for s in statuses if s.unlocked]
        label = "mastery-gated" if policy is Policy.MASTERY_GATED else "points-only  "
        out(f"  {label}: {len(opened)} open: {', '.join(opened)}")
        suggested = next_concept(statuses, mastery, rules)
        if suggested:
            out(f"                 next suggested: {names[suggested]}")
    out("\nSame student, same XP, same mastery. Only the unlock rule differs.\n")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="app.sessions.demo", description=__doc__.split("\n\n")[0])
    parser.add_argument("concept", nargs="?", default="prog.loops", help="e.g. prog.loops")
    parser.add_argument("--auto", action="store_true", help="a scripted student plays for you")
    parser.add_argument(
        "--misses", type=int, default=0, help="with --auto: wrong tries per gating question"
    )
    parser.add_argument("--seed", type=int, default=None, help="fix the random choices")
    args = parser.parse_args(argv)

    root = get_settings().content_root
    units = load_content(root, "prog")
    chunks = [c for u in units for c in chunk_unit(u)]
    known = [u.concept_id for u in units if u.concept_id]
    if args.concept not in known:
        print(f"Unknown concept {args.concept!r}. Choose one of:\n  " + "\n  ".join(known))
        return 2

    bank = build_question_bank(chunks)
    student: Student = Scripted(bank, misses=args.misses) if args.auto else Interactive()
    play(
        concept_id=args.concept,
        units=units,
        chunks=chunks,
        student=student,
        rng=random.Random(args.seed),
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
