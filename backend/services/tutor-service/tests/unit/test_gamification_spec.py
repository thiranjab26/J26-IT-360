"""The written gamification spec must match the code, so neither can drift on its own."""

from __future__ import annotations

import re
from pathlib import Path

import pytest

from app.gamification.progression import BADGES, BONUSES, LEVELS
from app.gamification.xp import XPRules

SPEC = Path(__file__).resolve().parents[5] / "docs" / "c3" / "gamification-spec.md"


@pytest.fixture(scope="module")
def spec() -> str:
    return SPEC.read_text(encoding="utf-8")


def table_rows(spec: str, heading: str) -> list[list[str]]:
    """The cells of each body row of the first table after a heading."""
    section = spec.split(f"## {heading}", 1)[1]
    rows = []
    for line in section.splitlines():
        if line.startswith("## ") and rows:
            break
        if line.startswith("|") and not set(line) <= set("|- "):
            rows.append([c.strip() for c in line.strip("|").split("|")])
    return rows[1:]  # the first row is the header


def test_the_levels_in_the_spec_are_the_levels_in_the_code(spec: str) -> None:
    rows = table_rows(spec, "Levels")

    assert [(int(r[0]), r[1], int(r[2])) for r in rows] == [
        (level.number, level.name, level.xp_required) for level in LEVELS
    ]


def test_the_badges_in_the_spec_are_the_badges_in_the_code(spec: str) -> None:
    rows = table_rows(spec, "Badges")

    assert [(r[0], r[1], r[2]) for r in rows] == [(b.name, b.rarity, b.description) for b in BADGES]


def test_the_bonuses_in_the_spec_are_the_bonuses_in_the_code(spec: str) -> None:
    amounts = {r[0]: int(r[1]) for r in table_rows(spec, "Bonus XP")}

    assert amounts == {
        "Concept cleared": BONUSES.concept_clear,
        "Flawless run": BONUSES.flawless,
        "Concept mastered": BONUSES.mastery,
        "Quest complete": BONUSES.quest,
        "Streak bonus": BONUSES.streak,
        "Practical passed (level 4)": BONUSES.practical,
        "Practical passed (level 5)": BONUSES.practical_hard,
    }


def test_the_checkpoint_points_in_the_spec_are_the_ones_in_the_code(spec: str) -> None:
    rules = XPRules()
    text = re.sub(r"\s+", " ", spec)

    assert f"passed first try, no hint | {rules.gating} |" in text
    assert f"answered correctly | {rules.pulse} |" in text
    assert f"minus {rules.hint_cost} |" in text
    assert f"minus {rules.retry_cost} |" in text
    assert f"| {rules.floor} |" in text


def test_the_streak_threshold_and_the_worked_example_are_current(spec: str) -> None:
    assert f"streak is {BONUSES.streak_from_days} days or more" in spec
    rules = XPRules()
    clean_concept = 2 * rules.pulse + 2 * rules.gating
    total = clean_concept + BONUSES.concept_clear + BONUSES.flawless + BONUSES.mastery
    assert f"{clean_concept} + {BONUSES.concept_clear} + {BONUSES.flawless} + " in spec
    assert f"= {total} XP" in spec


def test_the_spec_has_no_em_dash(spec: str) -> None:
    assert "—" not in spec
