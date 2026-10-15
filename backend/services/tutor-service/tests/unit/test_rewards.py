"""The gamification layer end to end: what a student is paid, once, for real work.

These run the session service on the real course with an in-memory repository, so they
check what a student would notice: the XP and badges after a session, that nothing is paid
twice, that streaks follow the calendar, and that both study conditions are paid the same.
"""

from __future__ import annotations

import uuid
from pathlib import Path

import pytest

from app.gamification.progression import BONUSES
from app.gamification.rules import Policy
from app.models.sessions import SessionOut
from app.sessions.catalog import UnknownModule, load_course
from app.sessions.service import SessionService
from tests.unit.session_support import Clock, InMemorySessionRepository

CONTENT = Path(__file__).resolve().parents[2] / "content"
LOOPS = "prog.loops"
INTRO = "prog.java_intro"  # the only concept in its topic, so one mastery completes the quest


@pytest.fixture(scope="module")
def course():
    return load_course(CONTENT, "prog")


def make(course, *, policy: Policy = Policy.MASTERY_GATED, repo=None, clock=None):
    repo = repo or InMemorySessionRepository()
    clock = clock or Clock()
    repo.clock = clock

    def courses(module_id: str):
        if module_id != "prog":
            raise UnknownModule(module_id)
        return course

    service = SessionService(
        repo, courses, clock=clock, enforce_unlocks=False, policy=policy, timezone="UTC"
    )
    return service, repo, clock


def right_answer(course, view: SessionOut) -> str:
    entry = course.bank[view.question.question_id]
    _, key = SessionService._presented(view.session_id, entry)
    return key.correct_option or key.expected_output or ""


def run(service, course, user: str, concept: str, *, misses: int = 0) -> list[SessionOut]:
    """Play a session to its end. Returns every response, so rewards can be inspected."""
    view = service.start(user, concept)
    responses = [view]
    while view.phase != "ended":
        if view.phase == "checkpoint":
            q = view.question
            wrong = q.gating and q.attempt <= misses
            view = service.answer(
                user, view.session_id, "definitely not it" if wrong else right_answer(course, view)
            )
        else:
            view = service.cont(user, view.session_id)
        responses.append(view)
    return responses


def bonus_kinds(responses: list[SessionOut]) -> list[str]:
    return [b.kind for r in responses if r.rewards for b in r.rewards.bonuses]


def badge_ids(responses: list[SessionOut]) -> list[str]:
    return [b.id for r in responses if r.rewards for b in r.rewards.badges]


@pytest.fixture
def student() -> str:
    return str(uuid.uuid4())


# -------------------------------------------------------------- a clean first session
def test_a_flawless_first_session_pays_every_bonus_once_and_the_right_badges(
    course, student
) -> None:
    service, repo, _ = make(course)

    responses = run(service, course, student, LOOPS)

    assert sorted(bonus_kinds(responses)) == ["concept_clear", "flawless", "mastery"]
    assert sorted(badge_ids(responses)) == [
        "concept_master",
        "first_steps",
        "flawless",
        "sharp_start",
    ]
    points = 2 * 10 + 2 * 120
    extra = BONUSES.concept_clear + BONUSES.flawless + BONUSES.mastery
    assert repo.total_xp(student) == points + extra
    assert responses[-1].summary.xp_earned == points + extra
    assert {b.kind for b in responses[-1].summary.bonuses} == {
        "concept_clear",
        "flawless",
        "mastery",
    }


def test_the_session_summary_lists_the_badges_earned_in_it(course, student) -> None:
    service, _, _ = make(course)

    summary = run(service, course, student, LOOPS)[-1].summary

    assert {b.id for b in summary.badges} == {
        "concept_master",
        "first_steps",
        "flawless",
        "sharp_start",
    }


def test_mastery_is_paid_when_it_is_reached_not_when_the_session_ends(course, student) -> None:
    service, _, _ = make(course)

    responses = run(service, course, student, LOOPS)

    paid_at = next(i for i, r in enumerate(responses) if "mastery" in bonus_kinds([r]))
    assert responses[paid_at].phase == "feedback", "paid on the answer that reached it"
    assert responses[-1].phase == "ended"
    assert paid_at < len(responses) - 1


def test_a_quick_check_pays_its_points_and_nothing_else(course, student) -> None:
    service, _, _ = make(course)
    view = service.start(student, LOOPS)
    while view.phase != "checkpoint":
        view = service.cont(student, view.session_id)
    assert not view.question.gating

    after = service.answer(student, view.session_id, right_answer(course, view))

    assert after.rewards.bonuses == [] and after.rewards.badges == []
    assert after.rewards.points == 10 and after.rewards.xp_gained == 10


def test_a_wrong_answer_pays_nothing(course, student) -> None:
    service, repo, _ = make(course)
    view = service.start(student, LOOPS)
    while not (view.phase == "checkpoint" and view.question.gating):
        view = (
            service.answer(student, view.session_id, right_answer(course, view))
            if view.phase == "checkpoint"
            else service.cont(student, view.session_id)
        )
    before = repo.total_xp(student)

    after = service.answer(student, view.session_id, "definitely not it")

    assert after.rewards is None and repo.total_xp(student) == before


# ----------------------------------------------------------------- nothing paid twice
def test_replaying_a_concept_the_same_day_pays_points_but_no_second_bonus(course, student) -> None:
    service, repo, _ = make(course)
    run(service, course, student, LOOPS)
    total_after_first = repo.total_xp(student)

    second = run(service, course, student, LOOPS)

    assert bonus_kinds(second) == [], "no grinding the same concept for its bonus"
    # Only a badge that was not held yet (this session's points cross 500 XP) may appear.
    assert set(badge_ids(second)) <= {"xp_500"}
    assert repo.total_xp(student) > total_after_first, "the checkpoint points still count"
    assert len([b for b in repo.bonus if b[2] == "mastery"]) == 1


def test_the_session_bonuses_return_the_next_day(course, student) -> None:
    service, repo, clock = make(course)
    run(service, course, student, LOOPS)
    clock.advance(days=1)

    next_day = run(service, course, student, LOOPS)

    assert sorted(bonus_kinds(next_day)) == ["concept_clear", "flawless"]
    assert set(badge_ids(next_day)) <= {"xp_500"}, "first-session badges are never re-awarded"
    assert len([b for b in repo.bonus if b[2] == "mastery"]) == 1


def test_replaying_the_same_bonus_is_refused_by_the_ledger(course, student) -> None:
    _, repo, _ = make(course)

    assert repo.add_xp_event(student, None, "mastery", LOOPS, 100) is True
    assert repo.add_xp_event(student, None, "mastery", LOOPS, 100) is False
    assert repo.award_badge(student, "first_steps", None) is True
    assert repo.award_badge(student, "first_steps", None) is False
    assert repo.total_xp(student) == 100


def test_a_struggling_session_earns_no_completion_bonus_and_no_badge(course, student) -> None:
    service, repo, _ = make(course)

    responses = run(service, course, student, LOOPS, misses=3)

    assert responses[-1].summary.exit_reason == "struggling"
    assert bonus_kinds(responses) == [] and badge_ids(responses) == []
    assert repo.bonus == []


def test_a_session_with_a_miss_is_not_flawless_but_still_clears_the_concept(
    course, student
) -> None:
    service, _, _ = make(course)

    responses = run(service, course, student, LOOPS, misses=1)

    assert "concept_clear" in bonus_kinds(responses)
    assert "flawless" not in bonus_kinds(responses)
    assert "flawless" not in badge_ids(responses)


def test_passing_after_a_reteach_earns_the_comeback_badge(course, student) -> None:
    service, _, _ = make(course)

    responses = run(service, course, student, LOOPS, misses=2)

    assert "comeback" in badge_ids(responses)


# ----------------------------------------------------------------------- levels
def test_each_level_threshold_crossed_is_announced_once_in_order(course, student) -> None:
    service, _, _ = make(course)

    responses = run(service, course, student, LOOPS)

    ups = [r.rewards.level_up for r in responses if r.rewards and r.rewards.level_up]
    assert [(u.from_level, u.to_level, u.name) for u in ups] == [
        (1, 2, "Apprentice"),
        (2, 3, "Coder"),
    ]


def test_rewards_report_the_level_after_the_change(course, student) -> None:
    service, _, _ = make(course)

    last = [r for r in run(service, course, student, LOOPS) if r.rewards][-1].rewards

    assert last.level.total_xp == 460 and last.level.name == "Coder"


# ------------------------------------------------------------------------ quests
def test_mastering_the_only_concept_of_a_topic_completes_its_quest(course, student) -> None:
    service, _, _ = make(course)
    topic = course.topic_of[INTRO]
    assert course.topics[topic] == (INTRO,)

    responses = run(service, course, student, INTRO)

    assert "quest" in bonus_kinds(responses) and "topic_champion" in badge_ids(responses)
    quest = next(q for q in service.progress(student, "prog").quests if q.topic == topic)
    assert quest.complete and quest.reward_claimed and quest.reward_xp == BONUSES.quest


def test_a_quest_with_unmastered_concepts_is_open(course, student) -> None:
    service, _, _ = make(course)
    run(service, course, student, LOOPS)  # one of three concepts in its topic

    quests = {q.topic: q for q in service.progress(student, "prog").quests}
    topic = quests[course.topic_of[LOOPS]]

    assert (topic.mastered, topic.total) == (1, 3)
    assert not topic.complete and not topic.reward_claimed


# ----------------------------------------------------------------------- streaks
def test_three_days_in_a_row_pays_the_streak_bonus_and_the_badge(course, student) -> None:
    service, repo, clock = make(course)

    run(service, course, student, INTRO)
    clock.advance(days=1)
    day2 = run(service, course, student, INTRO)
    clock.advance(days=1)
    day3 = run(service, course, student, INTRO)

    assert "streak" not in bonus_kinds(day2)
    assert "streak" in bonus_kinds(day3) and "on_fire" in badge_ids(day3)
    assert service.profile(student).streak.current == 3


def test_a_gap_day_breaks_the_streak(course, student) -> None:
    service, _, clock = make(course)
    run(service, course, student, INTRO)
    clock.advance(days=2)

    profile = service.profile(student)

    assert profile.streak.current == 0 and profile.streak.longest == 1


def test_the_streak_survives_until_the_end_of_the_day_after(course, student) -> None:
    service, _, clock = make(course)
    run(service, course, student, INTRO)
    clock.advance(days=1)

    profile = service.profile(student)

    assert profile.streak.current == 1 and profile.streak.learned_today is False


# ----------------------------------------------------------- the study's fairness
def test_both_study_conditions_are_paid_exactly_the_same(course) -> None:
    results = []
    for policy in (Policy.MASTERY_GATED, Policy.POINTS_ONLY):
        user = str(uuid.uuid4())
        service, repo, _ = make(course, policy=policy)
        responses = run(service, course, user, LOOPS)
        results.append(
            (repo.total_xp(user), sorted(bonus_kinds(responses)), sorted(badge_ids(responses)))
        )

    assert results[0] == results[1]


# ----------------------------------------------------------------------- profile
def test_the_profile_shows_level_badges_and_sessions(course, student) -> None:
    service, _, _ = make(course)
    run(service, course, student, LOOPS)

    profile = service.profile(student)

    assert profile.total_xp == 460 and profile.level.name == "Coder"
    assert profile.completed_sessions == 1
    earned = {b.id for b in profile.badges if b.earned}
    assert earned == {"concept_master", "first_steps", "flawless", "sharp_start"}
    assert len(profile.badges) == 11, "locked badges are listed too, so there is something to chase"
    assert all(b.earned_at is not None for b in profile.badges if b.earned)


def test_a_new_student_has_a_clean_profile(course, student) -> None:
    service, _, _ = make(course)

    profile = service.profile(student)

    assert (profile.total_xp, profile.level.number, profile.streak.current) == (0, 1, 0)
    assert not any(b.earned for b in profile.badges)


# -------------------------------------------------------------------- leaderboard
def test_the_leaderboard_ranks_by_xp_and_names_nobody_in_full(course) -> None:
    service, repo, clock = make(course)
    ann, bob, cho = (str(uuid.uuid4()) for _ in range(3))
    repo.names = {ann: "Ann Perera", bob: "Bob de Silva", cho: "Cho"}
    run(service, course, ann, LOOPS)
    run(service, course, bob, LOOPS, misses=1)

    board = service.leaderboard(bob)

    assert [(e.rank, e.name) for e in board.entries] == [(1, "Ann P."), (2, "Bob S.")]
    assert board.entries[0].xp > board.entries[1].xp
    assert [e.is_you for e in board.entries] == [False, True]
    assert board.you is None, "already in the top list"


def test_a_student_outside_the_top_is_still_shown_their_own_rank(course) -> None:
    service, repo, _ = make(course)
    ann, bob = str(uuid.uuid4()), str(uuid.uuid4())
    run(service, course, ann, LOOPS)
    run(service, course, bob, LOOPS, misses=1)

    board = service.leaderboard(bob, limit=1)

    assert [e.is_you for e in board.entries] == [False]
    assert board.you is not None and board.you.rank == 2


def test_students_with_no_xp_are_not_ranked(course, student) -> None:
    service, _, _ = make(course)

    assert service.leaderboard(student).entries == []
