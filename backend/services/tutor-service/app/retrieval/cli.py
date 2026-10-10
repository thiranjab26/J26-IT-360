"""Try retrieval from the command line.

    uv run python -m app.retrieval.cli search "why does my loop run one extra time"
    uv run python -m app.retrieval.cli search "..." --mode practical --concept prog.loops -k 8
    uv run python -m app.retrieval.cli search "..." --mode grading --concept prog.loops
    uv run python -m app.retrieval.cli question prog.loops 8

`search` applies the same access rules the tutor does, so what you see is what a mode
is allowed to be given. `question` shows the authored question with its solution and
rubric, the way the grader receives them.

Needs the index: run `uv run python -m app.content.cli index` first.
"""

from __future__ import annotations

import argparse
import sys

from app.config import get_settings
from app.content.embedder import SentenceTransformerEmbedder
from app.content.indexer import open_store
from app.retrieval.access import RetrievalMode
from app.retrieval.retriever import Passage, RetrievalError, Retriever


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="app.retrieval.cli", description=__doc__)
    parser.add_argument("--module", default="prog", help="module to search (default: prog)")
    sub = parser.add_subparsers(dest="command", required=True)

    search = sub.add_parser("search", help="similarity search within a mode's access rules")
    search.add_argument("query")
    search.add_argument(
        "--mode", choices=[m.value for m in RetrievalMode], default="tutoring", help="who is asking"
    )
    search.add_argument("--concept", action="append", help="limit to a concept; repeatable")
    search.add_argument("-k", type=int, default=5, help="how many passages (default 5)")
    search.add_argument("--max-distance", type=float, help="drop matches weaker than this")
    search.add_argument(
        "--method",
        choices=["hybrid", "dense"],
        default="hybrid",
        help="hybrid fuses embedding and keyword rankings (default); dense is embeddings only",
    )

    question = sub.add_parser("question", help="an authored question with solution and rubric")
    question.add_argument("unit_id", help="e.g. prog.loops")
    question.add_argument("number", type=int, help="question number, e.g. 8")

    args = parser.parse_args(argv)
    settings = get_settings()
    retriever = Retriever(
        open_store(settings.chroma_root), SentenceTransformerEmbedder(settings.embedding_model)
    )

    try:
        if args.command == "search":
            passages = retriever.search(
                args.query,
                mode=RetrievalMode(args.mode),
                module_id=args.module,
                concept_ids=args.concept,
                k=args.k,
                max_distance=args.max_distance,
                method=args.method,
            )
            print(f"{len(passages)} passage(s) for mode={args.mode}, method={args.method}\n")
            for passage in passages:
                _show(passage)
            return 0

        materials = retriever.question_materials(
            module_id=args.module, unit_id=args.unit_id, question_no=args.number
        )
        if materials is None:
            print(f"No question {args.number} in {args.unit_id}")
            return 1
        for label, passage in (
            ("QUESTION", materials.question),
            ("SOLUTION", materials.solution),
            ("RUBRIC", materials.rubric),
        ):
            print(f"--- {label} ---")
            print(passage.text if passage else "(none authored)")
            print()
        return 0
    except RetrievalError as exc:
        print(f"error: {exc}")
        return 2


def _show(passage: Passage) -> None:
    distance = f"{passage.distance:.3f}" if passage.distance is not None else "  -  "
    print(f"{distance}  {passage.section_type:<13} {passage.chunk_id}")
    print(f"       {passage.heading_path}")
    preview = " ".join(passage.text.split())
    print(f"       {preview[:130]}{'...' if len(preview) > 130 else ''}\n")


if __name__ == "__main__":
    sys.exit(main())
