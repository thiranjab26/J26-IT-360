"""Small helpers for reading the course markdown without being fooled by code.

Course files contain Java, and Java output blocks can contain lines that look like
markdown headings or section markers. Everything here treats the inside of a fenced
code block as opaque text.
"""

from __future__ import annotations

import re

FENCE_RE = re.compile(r"^\s{0,3}(`{3,}|~{3,})")
HEADING_RE = re.compile(r"^(#{1,6})\s+(.*?)\s*#*\s*$")


def scan_lines(text: str) -> tuple[list[tuple[str, bool]], bool]:
    """Split text into lines, flagging each as inside a code fence or not.

    Returns (lines, unclosed). A fence line itself counts as "in code", so a line
    like ```java is never mistaken for prose. `unclosed` is True if the text ends
    inside a fence, which almost always means a missing closing marker.
    """
    result: list[tuple[str, bool]] = []
    in_fence = False
    fence_char = ""

    for line in text.split("\n"):
        match = FENCE_RE.match(line)
        if match:
            char = match.group(1)[0]
            if not in_fence:
                in_fence, fence_char = True, char
                result.append((line, True))
                continue
            if char == fence_char:
                in_fence = False
                result.append((line, True))
                continue
        result.append((line, in_fence))

    return result, in_fence


def headings(lines: list[tuple[str, bool]]) -> list[tuple[int, str]]:
    """(level, text) of every markdown heading outside code, in order."""
    found: list[tuple[int, str]] = []
    for line, in_code in lines:
        if in_code:
            continue
        match = HEADING_RE.match(line)
        if match:
            found.append((len(match.group(1)), match.group(2)))
    return found
