"""The development code runner, against a real JDK. Skipped on a machine without one."""

from __future__ import annotations

import os
import subprocess

import pytest

from app.practicals.runner import LocalJavaRunner

runner = LocalJavaRunner(run_timeout=2.0)
pytestmark = pytest.mark.skipif(not runner.available(), reason="no JDK on this machine")

DOUBLE = (
    "import java.util.Scanner;\n"
    "public class Main { public static void main(String[] a) {\n"
    "  Scanner s = new Scanner(System.in); System.out.println(s.nextInt() * 2); } }\n"
)


def java_processes() -> int:
    if os.name != "nt":
        return int(
            subprocess.run(["pgrep", "-c", "java"], capture_output=True, text=True).stdout or 0
        )
    out = subprocess.run(
        ["tasklist", "/FI", "IMAGENAME eq java.exe"], capture_output=True, text=True, check=False
    ).stdout
    return out.count("java.exe")


def test_a_program_is_compiled_once_and_run_for_each_input() -> None:
    batch = runner.run_batch(DOUBLE, ["4\n", "10\n"])

    assert batch.compiled
    assert [(r.status, r.stdout.strip(), r.exit_code) for r in batch.runs] == [
        ("ok", "8", 0),
        ("ok", "20", 0),
    ]


def test_a_compile_error_is_reported_without_this_machines_paths() -> None:
    batch = runner.run_batch(
        'public class Main { public static void main(String[] a) { int x = "no"; } }', ["\n"]
    )

    assert not batch.compiled
    assert "incompatible types" in batch.compile_output
    assert "practical-" not in batch.compile_output and "Temp" not in batch.compile_output
    assert batch.runs == ()


def test_a_crash_is_a_runtime_error_with_the_exception_text() -> None:
    batch = runner.run_batch(DOUBLE, ["not a number\n"])

    run = batch.runs[0]
    assert run.status == "runtime_error" and run.exit_code != 0
    assert "InputMismatchException" in run.stderr


def test_an_endless_loop_is_stopped_at_the_time_limit_and_leaves_nothing_running() -> None:
    before = java_processes()
    loop = "public class Main { public static void main(String[] a) { while (true) {} } }"

    batch = runner.run_batch(loop, ["\n"])

    assert batch.runs[0].status == "timeout"
    assert java_processes() <= before, (
        "the whole process tree must be killed, not just the launcher"
    )


def test_a_program_that_prints_without_end_is_cut_off() -> None:
    flood = (
        "public class Main { public static void main(String[] a) {"
        ' while (true) System.out.println("spam spam spam spam"); } }'
    )

    run = runner.run_batch(flood, ["\n"]).runs[0]

    assert run.status == "output_limit" and len(run.stdout) <= runner.max_output


def test_a_program_that_uses_too_much_memory_fails_instead_of_taking_the_machine() -> None:
    hog = (
        "public class Main { public static void main(String[] a) {"
        " long[] x = new long[200_000_000]; System.out.println(x.length); } }"
    )

    run = runner.run_batch(hog, ["\n"]).runs[0]

    assert run.status == "runtime_error" and "OutOfMemoryError" in run.stderr


def test_a_very_long_program_is_refused_without_running_anything() -> None:
    batch = runner.run_batch("// " + "x" * 30_000, ["\n"])

    assert not batch.compiled and "too long" in batch.compile_output
