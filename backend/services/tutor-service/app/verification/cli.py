"""Generate and verify explanations ahead of time, so students read them from the cache.

    uv run python -m app.verification.cli status
    uv run python -m app.verification.cli prebuild [--concept prog.loops] [--limit 5] [--pause 4]

An explanation depends only on its course passage. Generating and checking it at the moment
a student asks costs several seconds and two or three model calls, and a free-tier model
rate-limits those calls. Doing it once here moves all of that off the student's path: every
session afterwards reads the verified text from `tutor.verified_explanations` instantly, and
never sees an unchecked explanation. A passage whose text the gate keeps blocking is left
uncached and reported, and at run time that passage shows the authored course text.

Changing the prompt, the model, the threshold or any other gate setting changes the cache
key, so run `prebuild` again after changing one (old rows are simply never read again).
"""

from __future__ import annotations

import argparse
import sys
import time

from app.config import get_settings
from app.db.session import SessionFactory
from app.sessions.catalog import get_course
from app.sessions.factory import build_writer, get_grounder
from app.sessions.repository import SqlSessionRepository
from app.sessions.writer import EXPLAIN, RETEACH
from app.verification.fill import ensure_verified


def _passages(course, concept: str | None) -> list[tuple[str, str, str]]:
    return [
        (ref, cid, course.chunk_text[ref])
        for cid in course.order
        if concept in (None, cid)
        for ref in course.theory[cid]
    ]


def _open(args):
    settings = get_settings()
    if getattr(args, "attempts", None):
        # More tries per passage than a live request would make. This changes how hard we
        # try, not what counts as verified, so the cache key is unaffected.
        settings = settings.model_copy(update={"gate_max_regenerations": args.attempts - 1})
    # Prebuilding is the cached way of working whatever mode the service runs in, so it keeps
    # its own "so many tries" rule instead of the live retry policy.
    settings = settings.model_copy(update={"explanation_mode": "cached"})
    writer, nli = build_writer(settings)
    fingerprint = writer.cache_fingerprint(EXPLAIN)
    if fingerprint is None:
        sys.exit(
            "Nothing to build: the faithfulness gate or the model is not configured "
            "(TUTOR_GATE_ENABLED, TUTOR_GEMINI_API_KEY)."
        )
    return writer, nli, fingerprint, _passages(get_course(args.module), args.concept)


def cmd_status(args: argparse.Namespace) -> int:
    writer, _, fingerprint, passages = _open(args)
    ground = get_grounder()
    course = get_course(args.module)
    print(f"fingerprint: {fingerprint}")
    with SessionFactory() as db:
        repo = SqlSessionRepository(db)
        for kind in (EXPLAIN, RETEACH):
            fp = writer.cache_fingerprint(kind)
            missing = [
                ref
                for ref, _, _ in passages
                if repo.get_verified(ref, ground(course, ref).digest, fp) is None
            ]
            done = len(passages) - len(missing)
            print(f"{kind}: {done} of {len(passages)} passages have a verified text")
            for ref in missing:
                print(f"  missing: {ref}")
    return 0


def cmd_prebuild(args: argparse.Namespace) -> int:
    writer, nli, _, passages = _open(args)
    if nli is not None:
        nli.load()
    course = get_course(args.module)
    ground = get_grounder()
    kinds = {"explain": (EXPLAIN,), "reteach": (RETEACH,), "both": (EXPLAIN, RETEACH)}[args.kind]

    built = skipped = failed = 0
    in_a_row = 0  # model failures straight after one another
    blocked: list[str] = []
    started = time.perf_counter()
    for n, (ref, _, _) in enumerate(passages[: args.limit or None], 1):
        grounding = ground(course, ref)
        for kind in kinds:
            label = f"{ref} ({kind}, {len(grounding.support)} retrieved)"
            outcome = ensure_verified(
                writer=writer,
                session_factory=SessionFactory,
                course=course,
                grounding=grounding,
                kind=kind,
                force=args.force,
            )
            if outcome.status == "cached":
                skipped += 1
                print(f"[{n}] {label}: already built")
                continue
            in_a_row = in_a_row + 1 if outcome.status == "failed" else 0
            if outcome.status == "built":
                built += 1
                print(f"[{n}] {label}: verified after {outcome.attempts} attempt(s)")
            elif outcome.status == "blocked":
                blocked.append(label)
                print(f"[{n}] {label}: BLOCKED by the gate on every attempt, left uncached")
            else:
                failed += 1
                print(f"[{n}] {label}: the model call failed, left uncached")
            if in_a_row >= args.stop_after:
                print(
                    f"\nStopping: {in_a_row} model calls in a row failed. That usually means "
                    "this key's daily quota is used up.\nSwitch to another key and run the "
                    "same command again; everything already built is skipped."
                )
                print(f"built {built}, already there {skipped} before stopping")
                return 2
            time.sleep(args.pause)  # be kind to a rate-limited model

    print(
        f"\nbuilt {built}, already there {skipped}, blocked {len(blocked)}, "
        f"model failures {failed} in {time.perf_counter() - started:.0f}s"
    )
    return 0 if not blocked and not failed else 1


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="app.verification.cli", description=__doc__.split("\n\n")[0]
    )
    parser.add_argument("--module", default="prog")
    parser.add_argument("--concept", help="only this concept, e.g. prog.loops")
    sub = parser.add_subparsers(dest="cmd", required=True)
    status = sub.add_parser("status")
    status.set_defaults(func=cmd_status)
    build = sub.add_parser("prebuild")
    # The concept can be given before or after the command. SUPPRESS keeps the subcommand
    # from overwriting a value given before it with its own default.
    for command in (status, build):
        command.add_argument(
            "--concept", default=argparse.SUPPRESS, help="only this concept, e.g. prog.loops"
        )
    build.add_argument("--limit", type=int, default=0, help="only the first N passages")
    build.add_argument("--pause", type=float, default=4.0, help="seconds between passages")
    build.add_argument(
        "--attempts",
        type=int,
        default=4,
        help="generations per passage before giving up (each is told what failed the last)",
    )
    build.add_argument(
        "--kind",
        choices=["explain", "reteach", "both"],
        default="both",
        help="explain is what every student reads; reteach is shown only after two misses",
    )
    build.add_argument(
        "--stop-after",
        type=int,
        default=3,
        help="stop after this many model failures in a row (a key out of quota)",
    )
    build.add_argument("--force", action="store_true", help="rebuild even if already cached")
    build.set_defaults(func=cmd_prebuild)
    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
