"""The terminal demo, driven by scripted students, so the whole engine is exercised together.

These run the real state machine, plan builder, question bank, marking, XP and unlock
rules over the real course content. They check behaviour a person would notice: a
perfect run, a run with misses, a run that fails, an unreadable answer.
"""

from __future__ import annotations

import random
from pathlib import Path

import pytest

from app.content.chunker import chunk_unit
from app.content.loader import load_content
from app.domain.questions import Question, build_question_bank
from app.sessions.demo import Scripted, Summary, main, play
from app.sessions.state_machine import ExitReason


@pytest.fixture(scope="module")
def course():
    root = Path(__file__).resolve().parents[2] / "content"
    units = load_content(root, "prog")
    chunks = [c for u in units for c in chunk_unit(u)]
    return units, chunks, build_question_bank(chunks)


def run(course, student, concept: str = "prog.loops", seed: int = 1) -> tuple[Summary, str]:
    units, chunks, _ = course
    lines: list[str] = []
    summary = play(
        concept_id=concept,
        units=units,
        chunks=chunks,
        student=student,
        rng=random.Random(seed),
        out=lines.append,
    )
    return summary, "\n".join(lines)


def test_a_perfect_session_completes_and_earns_full_xp(course) -> None:
    summary, transcript = run(course, Scripted(course[2], misses=0))

    assert summary.exit is ExitReason.COMPLETED
    assert (summary.passed_gating, summary.gating_total) == (2, 2)
    assert summary.xp == 2 * 10 + 2 * 120  # two quick checks and two gating checkpoints
    assert summary.mastery == 1.0
    assert "SESSION ENDED: completed" in transcript


def test_one_miss_earns_a_hint_and_less_xp_but_still_completes(course) -> None:
    perfect, _ = run(course, Scripted(course[2], misses=0))
    summary, transcript = run(course, Scripted(course[2], misses=1))

    assert summary.exit is ExitReason.COMPLETED
    assert summary.xp < perfect.xp
    assert "the tutor would add a hint here" in transcript
    assert "[RE-TEACH]" not in transcript


def test_two_misses_trigger_a_re_teach_before_the_third_try(course) -> None:
    summary, transcript = run(course, Scripted(course[2], misses=2))

    assert summary.exit is ExitReason.COMPLETED
    assert "[RE-TEACH]" in transcript
    assert summary.mastery is not None and summary.mastery < 1.0


def test_three_misses_end_the_session_as_struggling(course) -> None:
    summary, transcript = run(course, Scripted(course[2], misses=3))

    assert summary.exit is ExitReason.STRUGGLING
    assert summary.passed_gating == 0
    assert "SESSION ENDED: struggling" in transcript
    assert all(not r.passed for r in summary.gating_results)


def test_the_answer_to_a_gating_question_is_never_shown_before_the_student_gets_it(course) -> None:
    """A wrong gating answer must not reveal the explanation, or the retry is meaningless."""
    _, transcript = run(course, Scripted(course[2], misses=1))

    # From the first gating question up to the start of its retry: one wrong attempt,
    # its feedback, nothing else. The authored explanation (it gives the answer away)
    # must not appear until the student has got it right.
    first_gate = transcript.index("[CHECKPOINT (gating)")
    retry = transcript.index("try 2 of 3", first_gate)
    between = transcript[first_gate:retry]

    assert "Not quite." in between
    assert "Why:" not in between and "XP" not in between


def test_the_demo_shows_the_two_study_conditions_diverging(course) -> None:
    _, transcript = run(course, Scripted(course[2], misses=0))

    assert "mastery-gated:" in transcript and "points-only" in transcript
    gated_line = next(line for line in transcript.splitlines() if "mastery-gated:" in line)
    points_line = next(line for line in transcript.splitlines() if "points-only" in line)
    assert gated_line != points_line


class UnreadableThenCorrect(Scripted):
    """Answers 'E' (not an option) once, then answers properly."""

    def __init__(self, entries) -> None:
        super().__init__(entries)
        self.spent = False

    def answer(self, question: Question, gating: bool, attempt: int) -> str | None:
        if not self.spent:
            self.spent = True
            return "E"
        return super().answer(question, gating, attempt)


def test_an_unreadable_answer_is_asked_for_again_and_costs_nothing(course) -> None:
    summary, transcript = run(course, UnreadableThenCorrect(course[2]))

    assert "I could not read that as an answer" in transcript
    assert summary.exit is ExitReason.COMPLETED
    assert summary.xp == 2 * 10 + 2 * 120, "no XP or attempts were lost to the unreadable answer"


class WalksAway(Scripted):
    def read(self, prompt: str) -> bool:
        return False


def test_a_student_who_walks_away_ends_the_session_as_student_ended(course) -> None:
    summary, _ = run(course, WalksAway(course[2]))

    assert summary.exit is ExitReason.STUDENT_ENDED


def test_every_concept_in_the_course_can_be_played_through(course) -> None:
    units, _, bank = course
    for concept in [u.concept_id for u in units if u.concept_id]:
        summary, _ = run(course, Scripted(bank, misses=0), concept=concept)

        assert summary.exit is ExitReason.COMPLETED, concept
        assert summary.passed_gating == summary.gating_total >= 1, concept


def test_the_same_seed_plays_the_same_session(course) -> None:
    first, a = run(course, Scripted(course[2]), seed=7)
    second, b = run(course, Scripted(course[2]), seed=7)

    assert a == b and first.xp == second.xp


def test_an_unknown_concept_is_refused_with_the_list_of_real_ones(capsys) -> None:
    assert main(["prog.nonsense", "--auto"]) == 2
    assert "prog.loops" in capsys.readouterr().out
