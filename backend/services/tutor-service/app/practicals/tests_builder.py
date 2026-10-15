"""Make the tests a practical is marked with, from the course's own reference solution.

A practical's statement shows a sample input and the output it should give. Those samples are
the VISIBLE tests. More tests, hidden from the student, are made like this:

    1. a language model proposes extra inputs (edge cases: the smallest value, duplicates, zero,
       negatives), and is only ever asked for INPUTS;
    2. the course's reference solution is run on each input, and the output it prints is the
       expected answer.

So the model never decides what is correct. The authors' own solution does, and an input the
reference solution cannot handle (it crashes, times out, prints nothing) is simply dropped.
That also checks the course itself: if the reference solution does not print the sample output
shown in the statement, the question has an error, and it is reported.
"""

from __future__ import annotations

import json
import re
from collections.abc import Sequence
from dataclasses import dataclass, field

from app.llm.providers import LLMError, LLMProvider
from app.practicals.runner import CodeRunner

SAMPLE_RE = re.compile(
    r"Sample input[^\n]*:\s*```[a-z]*\n(.*?)```\s*Sample output[^\n]*:\s*```[a-z]*\n(.*?)```",
    re.S | re.I,
)

PROPOSE_SYSTEM = (
    "You write test inputs for a beginner programming exercise. "
    "Output ONLY a JSON array of strings, nothing else."
)


@dataclass(frozen=True)
class TestCase:
    __test__ = False  # not a pytest test class, whatever its name suggests

    stdin: str
    expected: str
    visible: bool
    source: str  # sample | generated


@dataclass
class BuiltTests:
    tests: list[TestCase] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)  # problems worth a person's attention

    @property
    def usable(self) -> bool:
        return bool(self.tests)


def parse_samples(statement: str) -> list[tuple[str, str]]:
    """(input, output) pairs shown in the statement."""
    return [(i.strip("\n") + "\n", o.rstrip()) for i, o in SAMPLE_RE.findall(statement)]


def same_output(actual: str, expected: str) -> bool:
    """Equal line by line, ignoring trailing spaces and blank lines at either end."""

    def lines(text: str) -> list[str]:
        rows = [row.rstrip() for row in text.replace("\r\n", "\n").replace("\r", "\n").split("\n")]
        while rows and not rows[0].strip():
            rows.pop(0)
        while rows and not rows[-1].strip():
            rows.pop()
        return rows

    return lines(actual) == lines(expected)


def propose_inputs(
    provider: LLMProvider, statement: str, reference: str, count: int = 8
) -> list[str]:
    prompt = (
        f"Exercise:\n<<<\n{statement}\n>>>\n\nReference solution:\n<<<\n{reference}\n>>>\n\n"
        f"Write {count} different inputs for this program, exactly as it reads them from standard "
        "input, with each line break written as \\n. Every input must be valid according to the "
        "exercise. Include the smallest and the largest sensible cases and tricky ones "
        "(duplicates, zero, negative numbers, a single element). Do not repeat the sample input."
    )
    reply = provider.generate(system=PROPOSE_SYSTEM, prompt=prompt, max_tokens=900, temperature=0.4)
    body = re.sub(r"^```(?:json)?\s*|\s*```$", "", reply.text.strip())
    data = json.loads(body)
    if not isinstance(data, list):
        raise ValueError("not a list")
    inputs = []
    for item in data:
        if isinstance(item, str) and item.strip():
            inputs.append(item if item.endswith("\n") else item + "\n")
    return inputs


def build_tests(
    statement: str,
    reference: str,
    runner: CodeRunner,
    provider: LLMProvider | None = None,
    *,
    max_hidden: int = 6,
) -> BuiltTests:
    built = BuiltTests()
    samples = parse_samples(statement)
    if not samples:
        built.notes.append("the statement shows no sample input and output")

    proposals: list[str] = []
    if provider is not None:
        try:
            proposals = propose_inputs(provider, statement, reference)
        except (LLMError, ValueError, json.JSONDecodeError) as exc:
            built.notes.append(
                f"no extra inputs were proposed ({type(exc).__name__}); samples only"
            )

    seen = {stdin for stdin, _ in samples}
    extra = []
    for stdin in proposals:
        if stdin not in seen:
            seen.add(stdin)
            extra.append(stdin)

    batch = runner.run_batch(reference, [s for s, _ in samples] + extra)
    if not batch.compiled:
        built.notes.append("the reference solution does not compile: " + batch.compile_output[:160])
        return built

    sample_runs, extra_runs = batch.runs[: len(samples)], batch.runs[len(samples) :]

    for number, ((stdin, shown), run) in enumerate(zip(samples, sample_runs, strict=True), 1):
        if run.status != "ok" or not same_output(run.stdout, shown):
            built.notes.append(
                f"sample {number}: the reference solution does not print the output shown in the "
                "statement. Fix the question or its sample."
            )
        # The statement's own sample is what the student was shown, so it stays the expected output.
        built.tests.append(TestCase(stdin, shown, True, "sample"))

    hidden = 0
    for stdin, run in zip(extra, extra_runs, strict=True):
        if run.status != "ok" or not run.stdout.strip():
            continue  # an input the reference solution cannot handle is not a good test
        # With no sample in the statement the student would have no example at all, so the
        # first generated test is shown as one.
        show = not samples and hidden == 0
        built.tests.append(TestCase(stdin, run.stdout.rstrip(), show, "generated"))
        hidden += 1
        if hidden >= max_hidden:
            break
    if provider is not None and hidden == 0:
        built.notes.append("no usable hidden tests came out of the proposed inputs")
    return built


JAVA_BLOCK_RE = re.compile(r"```java\n(.*?)```", re.S)


def starter_for(statement: str) -> str:
    """Where the student starts. For a fix-the-bugs question that is the broken program from
    the statement; otherwise an empty program that reads from standard input."""
    block = JAVA_BLOCK_RE.search(statement)
    if block and "program below" in statement.lower():
        return block.group(1).rstrip() + "\n"
    return starter_code()


def starter_code() -> str:
    return (
        "import java.util.Scanner;\n\n"
        "public class Main {\n"
        "    public static void main(String[] args) {\n"
        "        Scanner sc = new Scanner(System.in);\n"
        "        // write your solution here\n"
        "    }\n"
        "}\n"
    )


def describe(tests: Sequence[TestCase]) -> str:
    visible = sum(t.visible for t in tests)
    return f"{visible} visible, {len(tests) - visible} hidden"
