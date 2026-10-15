"""Levels, badges, streaks and flawless runs: the pure rules of the gamification layer."""

from __future__ import annotations

from datetime import date, timedelta

import pytest

from app.gamification.progression import (
    BADGE_BY_ID,
    BADGES,
    BONUS_LABELS,
    BONUSES,
    LEVELS,
    BadgeFacts,
    badges_due,
    current_streak,
    is_flawless,
    level_for,
    longest_streak,
)

TODAY = date(2026, 10, 14)


def days(*offsets: int) -> list[date]:
    return [TODAY - timedelta(days=o) for o in offsets]


# ---------------------------------------------------------------------------- levels
def test_levels_start_at_zero_and_rise_strictly() -> None:
    assert LEVELS[0].xp_required == 0
    thresholds = [level.xp_required for level in LEVELS]
    assert thresholds == sorted(set(thresholds))
    assert [level.number for level in LEVELS] == list(range(1, len(LEVELS) + 1))


@pytest.mark.parametrize(
    ("xp", "level"),
    [(0, 1), (149, 1), (150, 2), (399, 2), (400, 3), (3499, 7), (3500, 8), (6000, 10), (99999, 10)],
)
def test_the_level_for_a_total_changes_exactly_at_the_threshold(xp: int, level: int) -> None:
    assert level_for(xp).level.number == level


def test_progress_through_a_level_is_reported_for_the_bar() -> None:
    p = level_for(275)  # level 2 starts at 150, level 3 at 400

    assert (p.level.name, p.next_level.name) == ("Apprentice", "Coder")
    assert (p.xp_into_level, p.xp_for_next, p.percent) == (125, 250, 50.0)


def test_the_top_level_has_no_next_and_a_full_bar() -> None:
    p = level_for(7000)

    assert p.next_level is None and p.xp_for_next is None and p.percent == 100.0


def test_negative_xp_is_treated_as_zero() -> None:
    assert level_for(-5).level.number == 1


# --------------------------------------------------------------------------- streaks
def test_a_streak_counts_consecutive_days_ending_today() -> None:
    assert current_streak(days(0, 1, 2), TODAY) == 3


def test_a_streak_is_still_alive_if_the_student_has_not_learned_yet_today() -> None:
    assert current_streak(days(1, 2, 3, 4), TODAY) == 4


def test_a_missed_day_ends_the_streak() -> None:
    assert current_streak(days(2, 3), TODAY) == 0
    assert current_streak(days(0, 2, 3), TODAY) == 1


def test_several_answers_on_one_day_count_once() -> None:
    assert current_streak(days(0, 0, 0, 1), TODAY) == 2


def test_the_longest_streak_is_found_anywhere_in_the_history() -> None:
    assert longest_streak(days(0, 1, 5, 6, 7, 8, 20)) == 4
    assert longest_streak([]) == 0


# ---------------------------------------------------------------------------- badges
def test_every_badge_has_a_unique_id_a_known_rarity_and_no_em_dash() -> None:
    ids = [b.id for b in BADGES]
    assert len(ids) == len(set(ids)) and set(BADGE_BY_ID) == set(ids)
    for badge in BADGES:
        assert badge.rarity in {"common", "rare", "epic"}
        assert "—" not in badge.name + badge.description


def test_nothing_is_earned_by_a_newcomer() -> None:
    assert badges_due(BadgeFacts(), owned=()) == []


def test_each_rule_earns_its_own_badge() -> None:
    cases = {
        "first_steps": BadgeFacts(completed_sessions=1),
        "sharp_start": BadgeFacts(first_try_pass=True),
        "flawless": BadgeFacts(session_flawless=True),
        "comeback": BadgeFacts(comeback=True),
        "concept_master": BadgeFacts(mastered_concepts=1),
        "topic_champion": BadgeFacts(quests_complete=1),
        "on_fire": BadgeFacts(streak=3),
        "week_warrior": BadgeFacts(streak=7),
        "xp_500": BadgeFacts(total_xp=500),
        "xp_2000": BadgeFacts(total_xp=2000),
        "first_build": BadgeFacts(practicals_passed=1),
    }
    assert set(cases) == set(BADGE_BY_ID), "every badge must have a test"
    for badge_id, facts in cases.items():
        assert badge_id in [b.id for b in badges_due(facts, owned=())], badge_id


def test_a_badge_just_short_of_its_rule_is_not_earned() -> None:
    nearly = BadgeFacts(streak=2, total_xp=499, mastered_concepts=0, completed_sessions=0)

    assert badges_due(nearly, owned=()) == []


def test_a_badge_already_held_is_not_awarded_again() -> None:
    facts = BadgeFacts(completed_sessions=3, total_xp=600)

    due = [b.id for b in badges_due(facts, owned={"first_steps"})]

    assert due == ["xp_500"]


def test_a_seven_day_streak_earns_both_streak_badges() -> None:
    assert [b.id for b in badges_due(BadgeFacts(streak=7), owned=())] == ["on_fire", "week_warrior"]


# ---------------------------------------------------------------------------- flawless
def attempt(question: str, no: int, outcome: str, gating: bool = True):
    return (question, no, outcome, gating)


def test_a_session_of_first_try_passes_is_flawless() -> None:
    assert is_flawless([attempt("q1", 1, "correct"), attempt("q2", 1, "correct")], gating_done=2)


def test_one_miss_anywhere_spoils_it() -> None:
    mine = [attempt("q1", 1, "wrong"), attempt("q1", 2, "correct"), attempt("q2", 1, "correct")]

    assert not is_flawless(mine, gating_done=2)


def test_unreadable_answers_and_quick_checks_do_not_count_against_it() -> None:
    mine = [
        attempt("q1", 1, "unreadable"),
        attempt("q1", 1, "correct"),
        attempt("p1", 1, "wrong", gating=False),
        attempt("q2", 1, "correct"),
    ]

    assert is_flawless(mine, gating_done=2)


def test_a_session_that_passed_nothing_is_not_flawless() -> None:
    assert not is_flawless([], gating_done=0)
    assert not is_flawless([attempt("q1", 1, "wrong")], gating_done=0)


def test_a_question_asked_but_never_passed_spoils_it() -> None:
    mine = [attempt("q1", 1, "correct"), attempt("q2", 1, "wrong")]

    assert not is_flawless(mine, gating_done=1)


def test_stopping_early_on_mastery_after_clean_passes_still_counts() -> None:
    assert is_flawless([attempt("q1", 1, "correct")], gating_done=1)


# --------------------------------------------------------------------------- bonuses
def test_every_bonus_kind_is_labelled_and_positive() -> None:
    values = {
        "concept_clear": BONUSES.concept_clear,
        "flawless": BONUSES.flawless,
        "mastery": BONUSES.mastery,
        "quest": BONUSES.quest,
        "streak": BONUSES.streak,
        "practical": BONUSES.practical,
    }
    assert set(values) == set(BONUS_LABELS)
    assert all(v > 0 for v in values.values())
