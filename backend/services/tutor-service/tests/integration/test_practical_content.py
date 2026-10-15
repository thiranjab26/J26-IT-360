"""The course's own code questions, run for real.

Every practical's reference solution must compile and print exactly the sample output its
statement shows. If one does not, the question is wrong (or its sample is), and a student
would be marked against a lie. Skipped on a machine without a JDK.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from app.practicals.runner import LocalJavaRunner
from app.practicals.tests_builder import parse_samples, same_output
from app.sessions.catalog import load_course

CONTENT = Path(__file__).resolve().parents[2] / "content"
runner = LocalJavaRunner()
pytestmark = pytest.mark.skipif(not runner.available(), reason="no JDK on this machine")


def test_every_reference_solution_compiles_and_prints_its_own_sample() -> None:
    course = load_course(CONTENT, "prog")
    problems = []
    checked = 0
    for entry in course.bank.values():
        if entry.question.kind != "code":
            continue
        q = entry.question
        samples = parse_samples(q.stem)
        if not samples:
            continue
        batch = runner.run_batch(entry.key.reference_solution or "", [s for s, _ in samples])
        if not batch.compiled:
            problems.append(f"{q.question_id}: does not compile: {batch.compile_output[:100]}")
            continue
        for number, ((_, shown), run) in enumerate(zip(samples, batch.runs, strict=True), 1):
            checked += 1
            if run.status != "ok" or not same_output(run.stdout, shown):
                problems.append(f"{q.question_id}: sample {number} does not match its reference")

    assert checked >= 36
    assert problems == []
