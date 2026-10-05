"""Reading a markdown file into a Unit. Synthetic files, so no real content needed."""

from __future__ import annotations

from pathlib import Path

import pytest

from app.content.loader import ContentError, load_content, load_unit

FRONT = """---
concept_id: prog.demo
module: prog
sequence: 1
topic: Basics
title: "1. Demo Concept"
prerequisites: [prog.other]
cross_module_prerequisites: []
difficulty: 2
java_version: 21
version: 1
status: draft
---
"""

FACTS = "\n<!-- section: facts -->\n## Key Facts\n\n- A fact.\n"


def write(tmp_path: Path, body: str, *, front: str = FRONT, name: str = "01-demo.md") -> Path:
    folder = tmp_path / "prog"
    folder.mkdir(exist_ok=True)
    path = folder / name
    # Exact bytes, so the file is LF on every platform (write_text adds CRLF on Windows).
    path.write_bytes((front + body).encode("utf-8"))
    return path


def test_frontmatter_becomes_a_unit(tmp_path: Path) -> None:
    unit = load_unit(write(tmp_path, "\n# 1. Demo Concept\n" + FACTS), tmp_path)

    assert unit.unit_id == "prog.demo"
    assert unit.concept_id == "prog.demo"
    assert unit.module_id == "prog"
    assert unit.sequence == 1
    assert unit.prerequisites == ("prog.other",)
    assert unit.cross_module_prerequisites == ()
    assert unit.difficulty == 2
    assert unit.status == "draft"
    assert unit.source_path == "prog/01-demo.md"
    assert [s.section_type for s in unit.sections] == ["facts"]


def test_a_module_introduction_has_no_concept(tmp_path: Path) -> None:
    front = (
        "---\nmodule: prog\ntype: module_introduction\nsequence: 0\ntitle: Intro\nversion: 1\n---\n"
    )
    body = "\n# Intro\n\n<!-- section: overview -->\n## Hello\n\ntext\n"
    unit = load_unit(write(tmp_path, body, front=front), tmp_path)

    assert unit.kind == "module_introduction"
    assert unit.concept_id is None
    assert unit.unit_id == "prog.intro"


def test_heading_paths_follow_the_document(tmp_path: Path) -> None:
    body = """
# 1. Demo Concept

<!-- section: theory -->
## Theory

### First Idea

one

<!-- section: theory -->
### Second Idea

two

<!-- section: misconception -->
## Common Misconceptions

**"x"**
y
"""
    unit = load_unit(write(tmp_path, body), tmp_path)

    assert [s.heading_path for s in unit.sections] == [
        "Demo Concept > Theory > First Idea",
        "Demo Concept > Theory > Second Idea",
        "Demo Concept > Common Misconceptions",
    ]
    assert unit.sections[0].headings == ("First Idea",)


def test_markers_and_headings_inside_code_are_ignored(tmp_path: Path) -> None:
    body = """
<!-- section: example -->
## Worked Examples

### Example 1

```text
<!-- section: facts -->
## Not a heading
```

after the code
"""
    unit = load_unit(write(tmp_path, body), tmp_path)

    assert [s.section_type for s in unit.sections] == ["example"]
    assert unit.sections[0].headings == ("Example 1",)
    assert "<!-- section: facts -->" in unit.sections[0].text


def test_windows_line_endings_are_normalised(tmp_path: Path) -> None:
    path = write(tmp_path, FACTS)
    unix = load_unit(path, tmp_path)

    path.write_bytes(path.read_bytes().replace(b"\n", b"\r\n"))
    windows = load_unit(path, tmp_path)

    assert windows.sections[0].text == unix.sections[0].text
    assert windows.content_hash == unix.content_hash


def test_changing_a_file_changes_its_hash(tmp_path: Path) -> None:
    path = write(tmp_path, FACTS)
    before = load_unit(path, tmp_path).content_hash

    path.write_text(path.read_text(encoding="utf-8") + "\n- Another fact.\n", encoding="utf-8")

    assert load_unit(path, tmp_path).content_hash != before


@pytest.mark.parametrize(
    ("body", "message"),
    [
        ("\n<!-- section: nonsense -->\n## X\n", "unknown section type"),
        ("\n<!-- section: facts -->\n```java\nint x;\n", "never closed"),
        ("\nStray prose.\n<!-- section: facts -->\n## X\n", "before the first section marker"),
    ],
)
def test_unrecoverable_structure_is_refused(tmp_path: Path, body: str, message: str) -> None:
    with pytest.raises(ContentError, match=message):
        load_unit(write(tmp_path, body), tmp_path)


@pytest.mark.parametrize(
    ("front", "message"),
    [
        ("no frontmatter\n", "must start with"),
        ("---\nmodule: prog\n", "never closed"),
        ("---\nmodule: prog\nsequence: 1\ntitle: T\nversion: 1\n---\n", "concept_id"),
        (
            "---\nconcept_id: prog.x\nmodule: prog\nsequence: one\ntitle: T\nversion: 1\n---\n",
            "number",
        ),
    ],
)
def test_bad_frontmatter_is_refused(tmp_path: Path, front: str, message: str) -> None:
    with pytest.raises(ContentError, match=message):
        load_unit(write(tmp_path, "", front=front), tmp_path)


def test_errors_name_the_file_and_line(tmp_path: Path) -> None:
    path = write(tmp_path, "\n<!-- section: nonsense -->\n")
    with pytest.raises(ContentError) as caught:
        load_unit(path, tmp_path)

    assert "01-demo.md" in str(caught.value)
    assert caught.value.line is not None


def test_only_numbered_files_in_module_folders_are_loaded(tmp_path: Path) -> None:
    write(tmp_path, FACTS)
    (tmp_path / "prog" / "README.md").write_text("not content", encoding="utf-8")
    (tmp_path / "_templates").mkdir()
    (tmp_path / "_templates" / "01-template.md").write_text("ignored", encoding="utf-8")

    units = load_content(tmp_path)

    assert [u.unit_id for u in units] == ["prog.demo"]
