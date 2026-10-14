"""Break a tutor response into the statements the gate will check.

A response has two kinds of content and they are checked differently:

  * Prose is split into CLAIMS, single statements that an NLI model can judge against the
    course passage. Two splitters exist so that the choice is a measured one: sentences
    (rule-based, free, deterministic) and atomic claims (a language model rewrites each
    sentence into self-contained single facts, which helps when one sentence packs in
    several). If the model-based splitter fails, the sentence splitter takes over and the
    result says so.
  * Code is not language, so NLI is the wrong tool. Each fenced code block must consist
    of lines that appear in the course passage's own code. Invented code is blocked.
"""

from __future__ import annotations

import json
import re
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Protocol

from app.llm.providers import LLMError, LLMProvider
from app.retrieval.hybrid import tokens

FENCE_RE = re.compile(r"```[A-Za-z0-9_+-]*\n(.*?)```", re.S)
SENTENCE_BREAK_RE = re.compile(r"(?<=[.!?])\s+(?=[A-Z`\"'(\[])")
LIST_MARKER_RE = re.compile(r"^\s*(?:[-*+]|\d+[.)])\s+")
HEADING_RE = re.compile(r"^\s*#{1,6}\s+")
INLINE_MARKUP_RE = re.compile(r"(\*\*|__)")

CODE_PLACEHOLDER = "[a code example]"


@dataclass(frozen=True)
class Parts:
    """A response with its code taken out."""

    prose: str  # code blocks replaced by a short placeholder
    code_blocks: tuple[str, ...]


def split_parts(text: str) -> Parts:
    blocks = tuple(match.group(1).rstrip("\n") for match in FENCE_RE.finditer(text))
    prose = FENCE_RE.sub(f"\n{CODE_PLACEHOLDER}\n", text)
    return Parts(prose=prose, code_blocks=blocks)


def split_sentences(prose: str) -> list[str]:
    """Rule-based sentence splitting, tuned for short explanations with inline code.

    Headings, questions and fragments of under three words are not claims and are dropped.
    A sentence is never split inside backticks, or after an abbreviation such as `e.g.`.
    """
    sentences: list[str] = []
    for paragraph in re.split(r"\n\s*\n|\n(?=\s*(?:[-*+]|\d+[.)])\s)", prose):
        paragraph = paragraph.strip()
        if not paragraph or HEADING_RE.match(paragraph):
            continue
        paragraph = LIST_MARKER_RE.sub("", paragraph)
        paragraph = INLINE_MARKUP_RE.sub("", paragraph)
        paragraph = re.sub(r"\s*\n\s*", " ", paragraph)

        masked, stash = _mask_inline_code(paragraph)
        masked = re.sub(
            r"\b(e\.g|i\.e|etc|vs)\.\s", lambda m: m.group(0).replace(". ", ".\u0000"), masked
        )
        for piece in SENTENCE_BREAK_RE.split(masked):
            piece = _unmask(piece.replace("\u0000", " "), stash).strip()
            if _is_claim(piece):
                sentences.append(piece)
    return sentences


def _mask_inline_code(text: str) -> tuple[str, list[str]]:
    stash: list[str] = []

    def keep(match: re.Match[str]) -> str:
        stash.append(match.group(0))
        return f"\u0001{len(stash) - 1}\u0001"

    return re.sub(r"`[^`]*`", keep, text), stash


def _unmask(text: str, stash: list[str]) -> str:
    return re.sub(r"\u0001(\d+)\u0001", lambda m: stash[int(m.group(1))], text)


def _is_claim(sentence: str) -> bool:
    # Questions, exclamations ("Be careful!") and lead-ins to code ("Here it is:") assert
    # nothing, so there is nothing to check.
    if sentence == CODE_PLACEHOLDER or sentence.endswith(("?", "!", ":")):
        return False
    return len(sentence.split()) >= 3


# --------------------------------------------------------------------- decomposers
@dataclass(frozen=True)
class Decomposition:
    claims: tuple[str, ...]
    method: str  # "sentences" | "llm" | "llm->sentences" (the model failed, sentences used)


class Decomposer(Protocol):
    def decompose(self, prose: str) -> Decomposition: ...


class SentenceDecomposer:
    def decompose(self, prose: str) -> Decomposition:
        return Decomposition(tuple(split_sentences(prose)), "sentences")


ATOMIC_SYSTEM = (
    "You split a tutor's explanation into atomic factual claims for a fact-checker.\n"
    "Rules:\n"
    "- Output ONLY a JSON array of strings, nothing else.\n"
    "- Each string is ONE self-contained statement of fact. Replace pronouns such as it, "
    "this or they with the thing they refer to, so the claim makes sense alone.\n"
    "- Keep the meaning exactly. Do not add, correct, merge or strengthen anything.\n"
    "- Skip greetings, questions, instructions to the student, and the placeholder "
    f"{CODE_PLACEHOLDER}.\n"
    "- Keep Java names and inline code as they are, in backticks."
)


class LLMDecomposer:
    """Atomic claims written by a language model, with the sentence splitter as a net."""

    def __init__(self, provider: LLMProvider) -> None:
        self._provider = provider
        self._fallback = SentenceDecomposer()

    def decompose(self, prose: str) -> Decomposition:
        try:
            reply = self._provider.generate(
                system=ATOMIC_SYSTEM,
                prompt=f"Explanation:\n<<<\n{prose}\n>>>",
                max_tokens=900,
                temperature=0.0,
            )
            claims = _parse_claims(reply.text)
        except (LLMError, ValueError):
            fallback = self._fallback.decompose(prose)
            return Decomposition(fallback.claims, "llm->sentences")
        return Decomposition(tuple(claims), "llm")


def _parse_claims(reply: str) -> list[str]:
    body = reply.strip()
    body = re.sub(r"^```(?:json)?\s*|\s*```$", "", body)
    data = json.loads(body)
    if not isinstance(data, list) or not all(isinstance(item, str) for item in data):
        raise ValueError("expected a JSON array of strings")
    claims = [item.strip() for item in data if _is_claim(item.strip())]
    if not claims:
        raise ValueError("no claims")
    return claims


# ------------------------------------------------------------------------- trimming
def _prose_sentences(line: str) -> list[str]:
    masked, stash = _mask_inline_code(line)
    return [_unmask(piece, stash) for piece in SENTENCE_BREAK_RE.split(masked) if piece.strip()]


def trim_unsupported(
    text: str,
    unsupported: Sequence[str],
    *,
    max_removed: float = 0.4,
    min_words: int = 40,
) -> str | None:
    """The text with the sentences that carry the unsupported claims taken out, or None.

    A checker that rejects a whole explanation over one stray sentence wastes the rest. The
    claim-level verdicts say WHICH statements failed, so those sentences can be cut and the
    remainder checked again; it is shown only if it passes the same gate.

    Returns None, and the caller falls back to the course text, when it cannot be done with
    confidence: a failed claim matches no sentence closely enough to know what to remove,
    too much would go (the rest would no longer be the explanation), or too little is left.
    Code blocks, headings and table rows are never cut.
    """
    segments: list[tuple[str, str]] = []  # (kind, text): "keep" | "line" (prose to trim)
    position = 0
    for match in FENCE_RE.finditer(text):
        segments += [("prose", text[position : match.start()]), ("keep", match.group(0))]
        position = match.end()
    segments.append(("prose", text[position:]))

    # Every removable sentence, with where it sits: (segment, line, sentence index).
    layout: list[list[list[str]]] = []
    flat: list[tuple[int, int, int, str]] = []
    for seg_index, (kind, chunk) in enumerate(segments):
        lines: list[list[str]] = []
        if kind == "prose":
            for line_index, line in enumerate(chunk.split("\n")):
                stripped = line.strip()
                removable = stripped and not stripped.startswith(("#", "|", "```"))
                sentences = _prose_sentences(line) if removable else [line]
                lines.append(sentences)
                if removable:
                    for sent_index, sentence in enumerate(sentences):
                        flat.append((seg_index, line_index, sent_index, sentence))
        layout.append(lines)

    doomed: set[tuple[int, int, int]] = set()
    for claim in unsupported:
        words = set(tokens(claim))
        if not words:
            return None
        best, best_score = None, 0.0
        for seg_index, line_index, sent_index, sentence in flat:
            score = len(words & set(tokens(sentence))) / len(words)
            if score > best_score:
                best, best_score = (seg_index, line_index, sent_index), score
        if best is None or best_score < 0.5:
            return None
        doomed.add(best)
    if not doomed:
        return None

    total = sum(len(tokens(sentence)) for *_, sentence in flat)
    removed = sum(
        len(tokens(sentence)) for seg, ln, sn, sentence in flat if (seg, ln, sn) in doomed
    )
    if total == 0 or removed / total > max_removed or total - removed < min_words:
        return None

    out: list[str] = []
    for seg_index, (kind, chunk) in enumerate(segments):
        if kind == "keep":
            out.append(chunk)
            continue
        rebuilt: list[str] = []
        for line_index, sentences in enumerate(layout[seg_index]):
            kept = [
                sentence
                for sent_index, sentence in enumerate(sentences)
                if (seg_index, line_index, sent_index) not in doomed
            ]
            if not kept and sentences != [chunk.split("\n")[line_index]]:
                continue  # the whole line was cut
            rebuilt.append(" ".join(kept) if len(sentences) > 1 else (kept[0] if kept else ""))
        out.append("\n".join(rebuilt))
    result = re.sub(r"\n{3,}", "\n\n", "".join(out)).strip()
    return result or None


# ------------------------------------------------------------------ passage windows
def passage_windows(passage: str, size: int = 2) -> list[str]:
    """Short stretches of a passage: each block alone and each run of `size` blocks.

    A claim usually rests on one or two paragraphs, but an NLI model reading a whole
    passage can lose it among everything else, so a true claim scores low. Judging the
    claim against the short stretches as well as the whole is how the gate recovers it.
    Blocks are paragraphs, lists, tables and code examples (a fenced block is never cut).
    """
    masked = FENCE_RE.sub(lambda m: m.group(0).replace("\n\n", "\n\u0002\n"), passage)
    blocks = [b.replace("\u0002", "").strip() for b in re.split(r"\n\s*\n", masked) if b.strip()]
    # A heading or a one-line fragment is not a stretch that can support a claim by itself.
    windows = [block for block in blocks if len(block.split()) >= 8]
    for start in range(len(blocks) - size + 1):
        windows.append("\n\n".join(blocks[start : start + size]))
    whole = passage.strip()
    seen: set[str] = set()
    unique = []
    for window in windows:
        if window != whole and window not in seen:
            seen.add(window)
            unique.append(window)
    return unique


# ------------------------------------------------------------------------ code
def _normal(line: str) -> str:
    return re.sub(r"\s+", " ", line.strip())


def unsupported_code_lines(code_blocks: tuple[str, ...], passage: str) -> list[str]:
    """Lines of generated code that do not appear in any code block of the passage.

    A response may show part of an example from the passage, in any order, but it may not
    show code the passage does not contain. Whitespace differences are ignored; blank lines
    and lone braces carry no meaning and are skipped.
    """
    allowed = {
        _normal(line)
        for block in FENCE_RE.findall(passage)
        for line in block.splitlines()
        if _normal(line)
    }
    # Inline code in the passage counts as code the passage contains too.
    allowed.update(_normal(m) for m in re.findall(r"`([^`\n]+)`", passage))

    missing: list[str] = []
    for block in code_blocks:
        for line in block.splitlines():
            line = _normal(line)
            if not line or line in {"{", "}", "};"}:
                continue
            if line not in allowed:
                missing.append(line)
    return missing
