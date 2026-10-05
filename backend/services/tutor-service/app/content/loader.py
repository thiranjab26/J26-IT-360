"""Read authored markdown files into Units. No database, no FastAPI.

A file is YAML frontmatter followed by sections, each introduced by a
`<!-- section: <type> -->` comment. This module is strict about structure it cannot
recover from (bad frontmatter, an unknown section type, an unclosed code fence, prose
outside any section) and raises ContentError with the file and line. Whether the
content is *right* (every question has a solution, prerequisites resolve) is a
separate concern, handled in validate.py so it can report every problem at once.
"""

from __future__ import annotations

import hashlib
import re
from pathlib import Path
from typing import Any

import yaml

from app.content.markdown import HEADING_RE, headings, scan_lines
from app.content.models import (
    KIND_CONCEPT,
    KIND_MODULE_INTRO,
    KNOWN_SECTION_TYPES,
    Section,
    Unit,
)

MARKER_RE = re.compile(r"^<!--\s*section:\s*([a-z_]+)\s*-->\s*$")

# For these, each marker introduces one sub-topic, so the first ### heading is part
# of where the block sits. For the rest the block is a whole section on its own.
SUBTOPIC_SECTIONS = {"theory", "example"}

FILENAME_RE = re.compile(r"^(\d{2})-.+\.md$")


class ContentError(Exception):
    """A file that cannot be parsed. Carries enough to find the problem."""

    def __init__(self, path: Path | str, message: str, line: int | None = None) -> None:
        where = f"{path}:{line}" if line else str(path)
        super().__init__(f"{where}: {message}")
        self.path = str(path)
        self.line = line
        self.message = message


def load_unit(path: Path, content_root: Path) -> Unit:
    text = path.read_text(encoding="utf-8").replace("\r\n", "\n").replace("\r", "\n")
    meta, body, body_first_line = _split_frontmatter(path, text)

    kind = KIND_MODULE_INTRO if meta.get("type") == KIND_MODULE_INTRO else KIND_CONCEPT
    module_id = _required(path, meta, "module")
    title = str(_required(path, meta, "title"))

    if kind == KIND_CONCEPT:
        concept_id: str | None = str(_required(path, meta, "concept_id"))
        unit_id = concept_id
    else:
        concept_id = None
        unit_id = f"{module_id}.intro"

    return Unit(
        unit_id=unit_id,
        module_id=str(module_id),
        concept_id=concept_id,
        kind=kind,
        sequence=_as_int(path, meta, "sequence", required=True),
        topic=_optional_str(meta.get("topic")),
        title=title,
        difficulty=_as_int(path, meta, "difficulty"),
        prerequisites=_as_list(meta.get("prerequisites")),
        cross_module_prerequisites=_as_list(meta.get("cross_module_prerequisites")),
        java_version=_as_int(path, meta, "java_version"),
        version=_as_int(path, meta, "version", required=True) or 1,
        status=str(meta.get("status", "draft")),
        source_path=path.relative_to(content_root).as_posix(),
        content_hash=hashlib.sha256(text.encode("utf-8")).hexdigest(),
        sections=_parse_sections(path, body, body_first_line, root=_strip_number(title)),
    )


def load_content(content_root: Path, module: str | None = None) -> list[Unit]:
    """Every unit under content_root, in module then file order.

    Each subfolder is a module (`prog/`, `dsa/`). Files that do not match
    `NN-name.md` are ignored, so a README or a drafts folder does no harm.
    """
    if not content_root.is_dir():
        raise ContentError(content_root, "content folder does not exist")

    units: list[Unit] = []
    for module_dir in sorted(p for p in content_root.iterdir() if p.is_dir()):
        if module_dir.name.startswith(("_", ".")):
            continue
        if module is not None and module_dir.name != module:
            continue
        for path in sorted(module_dir.glob("*.md")):
            if FILENAME_RE.match(path.name):
                units.append(load_unit(path, content_root))
    return units


# ---------------------------------------------------------------------------
# Frontmatter
# ---------------------------------------------------------------------------
def _split_frontmatter(path: Path, text: str) -> tuple[dict[str, Any], str, int]:
    if not text.startswith("---\n"):
        raise ContentError(path, "file must start with a --- frontmatter block", 1)

    end = text.find("\n---\n", 3)
    if end == -1:
        raise ContentError(path, "frontmatter is never closed with ---", 1)

    try:
        meta = yaml.safe_load(text[4:end]) or {}
    except yaml.YAMLError as exc:
        raise ContentError(path, f"frontmatter is not valid YAML: {exc}", 1) from exc

    if not isinstance(meta, dict):
        raise ContentError(path, "frontmatter must be key: value pairs", 1)

    body = text[end + len("\n---\n") :]
    body_first_line = text[: end + len("\n---\n")].count("\n") + 1
    return meta, body, body_first_line


def _required(path: Path, meta: dict[str, Any], key: str) -> Any:
    value = meta.get(key)
    if value is None or value == "":
        raise ContentError(path, f"frontmatter is missing required key `{key}`", 1)
    return value


def _as_int(path: Path, meta: dict[str, Any], key: str, *, required: bool = False) -> int | None:
    value = meta.get(key)
    if value is None:
        if required:
            raise ContentError(path, f"frontmatter is missing required key `{key}`", 1)
        return None
    try:
        return int(value)
    except (TypeError, ValueError) as exc:
        raise ContentError(path, f"frontmatter `{key}` must be a number, got {value!r}", 1) from exc


def _as_list(value: Any) -> tuple[str, ...]:
    if value is None:
        return ()
    if isinstance(value, str):
        return (value,)
    return tuple(str(item) for item in value)


def _optional_str(value: Any) -> str | None:
    return None if value is None else str(value)


def _strip_number(title: str) -> str:
    """'5. Loops' -> 'Loops'. The number is the file order, not part of the name."""
    return re.sub(r"^\d+\.\s*", "", title.strip())


# ---------------------------------------------------------------------------
# Sections
# ---------------------------------------------------------------------------
def _parse_sections(path: Path, body: str, first_line: int, *, root: str) -> tuple[Section, ...]:
    pairs, unclosed = scan_lines(body)
    if unclosed:
        raise ContentError(path, "a code fence is opened but never closed")

    # Group lines into (type, start_line, lines) blocks at each marker.
    blocks: list[tuple[str, int, list[tuple[str, bool]]]] = []
    for offset, (line, in_code) in enumerate(pairs):
        number = first_line + offset
        marker = None if in_code else MARKER_RE.match(line)
        if marker:
            section_type = marker.group(1)
            if section_type not in KNOWN_SECTION_TYPES:
                raise ContentError(
                    path,
                    f"unknown section type `{section_type}` "
                    f"(known: {', '.join(KNOWN_SECTION_TYPES)})",
                    number,
                )
            blocks.append((section_type, number, []))
            continue

        if blocks:
            blocks[-1][2].append((line, in_code))
        elif line.strip() and not (HEADING_RE.match(line) and line.startswith("# ")):
            # Anything but the document title before the first marker belongs to no
            # section, so retrieval could never see it. Better to refuse than to lose it.
            raise ContentError(path, "text appears before the first section marker", number)

    sections: list[Section] = []
    current_h2: str | None = None

    for section_type, start_line, lines in blocks:
        found = headings(lines)
        h2s = [text for level, text in found if level == 2]
        h3s = tuple(text for level, text in found if level == 3)

        # A block that opens with its own ## heading names the section; one that
        # does not (later theory blocks) continues the one before it.
        block_h2 = h2s[0] if h2s else current_h2
        if h2s:
            current_h2 = h2s[-1]

        parts = [root]
        if block_h2:
            parts.append(block_h2)
        if section_type in SUBTOPIC_SECTIONS and h3s:
            parts.append(h3s[0])

        text = "\n".join(line for line, _ in lines).strip("\n")
        sections.append(
            Section(
                section_type=section_type,
                text=text,
                heading_path=" > ".join(parts),
                headings=h3s,
                start_line=start_line,
            )
        )

    return tuple(sections)
