"""Build and inspect the tests behind the practicals.

    uv run python -m app.practicals.cli build-tests [--concept prog.loops] [--force] [--no-llm]
    uv run python -m app.practicals.cli status

`build-tests` reads each program-writing question, runs the course's reference solution, and
stores the sample test plus hidden tests made from model-proposed inputs (see tests_builder.py).
It also reports questions whose reference solution does not print the sample output shown in
the statement. Those are mistakes in the course material and are worth fixing.
"""

from __future__ import annotations

import argparse
import sys
import time

from app.config import get_settings
from app.db.session import SessionFactory
from app.llm.providers import build_provider
from app.practicals.repository import SqlPracticalRepository
from app.practicals.runner import LocalJavaRunner
from app.practicals.service import CODE, practical_id
from app.practicals.tests_builder import build_tests, describe
from app.sessions.catalog import get_course


def _questions(module: str, concept: str | None):
    course = get_course(module)
    position = {c: i for i, c in enumerate(course.order)}
    entries = [
        e
        for e in course.bank.values()
        if e.question.kind == CODE and concept in (None, e.question.concept_id)
    ]
    return sorted(entries, key=lambda e: (position[e.question.concept_id], e.question.number))


def cmd_status(args: argparse.Namespace) -> int:
    entries = _questions(args.module, args.concept)
    with SessionFactory() as db:
        repo = SqlPracticalRepository(db)
        for e in entries:
            tests = repo.tests(e.question.question_id)
            line = describe(tests) if tests else "NO TESTS"
            print(f"{practical_id(e.question.question_id):40} {line}")
        print(
            f"\n{sum(bool(repo.tests(e.question.question_id)) for e in entries)} of "
            f"{len(entries)} have tests"
        )
    return 0


def cmd_build(args: argparse.Namespace) -> int:
    runner = LocalJavaRunner()
    if not runner.available():
        print("No JDK found: install one and put javac on the PATH.")
        return 2
    provider = None if args.no_llm else build_provider(get_settings())
    if provider is None and not args.no_llm:
        print(
            "No model is configured, so only the sample tests will be made "
            "(use --no-llm to say so)."
        )

    problems: list[str] = []
    built = skipped = 0
    for entry in _questions(args.module, args.concept):
        q = entry.question
        with SessionFactory() as db:
            have = SqlPracticalRepository(db).tests(q.question_id)
        if have and not args.force:
            skipped += 1
            continue

        result = build_tests(q.stem, entry.key.reference_solution or "", runner, provider)
        for note in result.notes:
            problems.append(f"{q.question_id}: {note}")
        if not result.usable:
            print(f"{q.question_id}: no tests could be made")
            continue
        with SessionFactory() as db:
            SqlPracticalRepository(db).replace_tests(q.question_id, result.tests)
            db.commit()
        built += 1
        print(f"{q.question_id}: {describe(result.tests)}")
        if provider is not None:
            time.sleep(args.pause)  # be kind to a rate-limited model

    print(f"\nbuilt {built}, already there {skipped}")
    if problems:
        print("\nThings to look at:")
        for line in problems:
            print("  -", line)
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="app.practicals.cli", description=__doc__.split("\n\n")[0]
    )
    parser.add_argument("--module", default="prog")
    parser.add_argument("--concept", help="only this concept, e.g. prog.loops")
    sub = parser.add_subparsers(dest="cmd", required=True)
    status = sub.add_parser("status")
    status.set_defaults(func=cmd_status)
    build = sub.add_parser("build-tests")
    # The concept can be given before or after the command.
    for command in (status, build):
        command.add_argument(
            "--concept", default=argparse.SUPPRESS, help="only this concept, e.g. prog.loops"
        )
    build.add_argument("--force", action="store_true", help="rebuild even if tests exist")
    build.add_argument("--no-llm", action="store_true", help="sample tests only, no model calls")
    build.add_argument("--pause", type=float, default=2.0, help="seconds between model calls")
    build.set_defaults(func=cmd_build)
    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
