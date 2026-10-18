"""Generation jobs and bulk review: progress, partial failure, and approving many at once."""

from __future__ import annotations

import uuid
from contextlib import contextmanager
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest

from app.practicals.authoring import AuthoringService
from app.practicals.generation import DraftGenerator
from app.practicals.jobs import JobRunner, expire_if_stale, job_out, new_job
from app.sessions.catalog import load_course
from tests.unit.practical_support import (
    FakeRunner,
    InMemoryAssessmentStore,
    InMemoryJobStore,
    InMemoryPracticalRepository,
)
from tests.unit.test_generation import FakeNLI, ScriptedProvider, reply

CONTENT = Path(__file__).resolve().parents[2] / "content"
LECTURER = str(uuid.uuid4())
LOOPS = "prog.loops"


@pytest.fixture(scope="module")
def course():
    return load_course(CONTENT, "prog")


class Setup:
    def __init__(self, course, *replies: str, runner=None) -> None:
        self.store = InMemoryAssessmentStore()
        self.repo = InMemoryPracticalRepository()
        self.jobs = InMemoryJobStore()
        self.provider = ScriptedProvider(*replies)
        runner = runner or FakeRunner(lambda stdin: stdin)
        self.author = AuthoringService(self.store, self.repo, course, runner)
        self.generator = DraftGenerator(course, runner, self.provider, FakeNLI(), 0.77)

        @contextmanager
        def scope():
            yield self.author, self.jobs

        self.runner = JobRunner(scope, lambda: self.generator, pause=0)

    def job(self, count: int, hint: str | None = None):
        targets = self.author.plan_targets(LOOPS, count)
        job = new_job(LOOPS, targets, hint, LECTURER)
        self.jobs.create(job)
        return job

    def reply_for(self, n: int) -> list[str]:
        """What the model says for n drafts: a proposal, then extra test inputs, each time."""
        return [
            x for i in range(n) for x in (reply(title=f"Draft {i}", description=f"Task {i}."), "[]")
        ]


# -------------------------------------------------------------------------------- the job
def test_a_job_makes_one_draft_per_target_and_counts_them(course) -> None:
    setup = Setup(course, *Setup(course).reply_for(3))
    job = setup.job(3, "keep it simple")

    setup.runner.run(job.job_id)

    done = setup.jobs.get(job.job_id)
    assert (done.status, done.done, done.failed, done.requested) == ("finished", 3, 0, 3)
    assert len(done.item_ids) == 3 and done.finished_at is not None
    drafts = [i for i in setup.store.all() if i.status == "draft"]
    assert len(drafts) == 3 and all(d.generation["job_id"] == job.job_id for d in drafts)
    assert all(d.generation["hint"] == "keep it simple" for d in drafts)
    assert job_out(done).draft_ids == done.item_ids


def test_drafts_are_saved_as_they_are_made_not_at_the_end(course) -> None:
    setup = Setup(course, *Setup(course).reply_for(1))
    job = setup.job(2)  # the model has an answer for only one

    setup.runner.run(job.job_id)

    assert len([i for i in setup.store.all() if i.status == "draft"]) == 1


def test_when_the_model_runs_out_the_job_keeps_what_it_made_and_stops(course) -> None:
    setup = Setup(course, *Setup(course).reply_for(1))  # the second call hits the quota
    job = setup.job(3)

    setup.runner.run(job.job_id)

    done = setup.jobs.get(job.job_id)
    assert (done.status, done.done, done.failed) == ("finished", 1, 2)
    assert "could not be reached" in done.message


def test_a_job_that_makes_nothing_is_a_failure(course) -> None:
    setup = Setup(course)  # the model is down from the start
    job = setup.job(2)

    setup.runner.run(job.job_id)

    done = setup.jobs.get(job.job_id)
    assert (done.status, done.done, done.failed) == ("failed", 0, 2)
    assert setup.store.all() == []


def test_one_unusable_reply_fails_one_draft_and_the_job_carries_on(course) -> None:
    replies = ["junk", "junk", *Setup(course).reply_for(1)]
    setup = Setup(course, *replies)
    job = setup.job(2)

    setup.runner.run(job.job_id)

    done = setup.jobs.get(job.job_id)
    assert (done.status, done.done, done.failed) == ("finished", 1, 1)
    assert "could not be used" in done.message


def test_a_job_runs_once(course) -> None:
    setup = Setup(course, *Setup(course).reply_for(2))
    job = setup.job(1)

    setup.runner.run(job.job_id)
    setup.runner.run(job.job_id)  # a second start finds it no longer queued

    assert len([i for i in setup.store.all() if i.status == "draft"]) == 1


def test_a_generator_that_cannot_be_built_fails_the_job_with_the_reason(course) -> None:
    setup = Setup(course)

    def broken():
        raise RuntimeError("no model configured")

    setup.runner.make_generator = broken
    job = setup.job(1)

    setup.runner.run(job.job_id)

    done = setup.jobs.get(job.job_id)
    assert done.status == "failed" and "no model configured" in done.message


def test_a_job_lost_in_a_restart_is_reported_as_failed_not_running_forever(course) -> None:
    setup = Setup(course)
    job = setup.job(1)
    old = datetime.now(UTC) + timedelta(hours=2)

    expired = expire_if_stale(setup.jobs, setup.jobs.get(job.job_id), now=old)

    assert expired.status == "failed" and "interrupted" in expired.message
    assert setup.jobs.get(job.job_id).status == "failed"
    fresh = setup.job(1)
    assert expire_if_stale(setup.jobs, setup.jobs.get(fresh.job_id)).status == "queued"


# ------------------------------------------------------------------------------ bulk review
def make_drafts(course, n: int):
    setup = Setup(course, *Setup(course).reply_for(n))
    job = setup.job(n)
    setup.runner.run(job.job_id)
    return setup, setup.jobs.get(job.job_id).item_ids


def test_several_drafts_are_approved_in_one_go(course) -> None:
    setup, ids = make_drafts(course, 3)

    results = setup.author.approve_many(LECTURER, ids, "reviewed together")

    assert [r.ok for r in results] == [True, True, True]
    approved = [i for i in setup.store.all() if i.status == "approved"]
    assert len(approved) == 3 and all(i.review_note == "reviewed together" for i in approved)


def test_one_bad_draft_does_not_stop_the_rest(course) -> None:
    setup, ids = make_drafts(course, 3)
    setup.author.reject(LECTURER, ids[1], "no")  # already decided, so it cannot be approved

    results = setup.author.approve_many(LECTURER, [*ids, "prog.loops~gen-missing"], None)

    by_id = {r.practical_id: r for r in results}
    assert by_id[ids[0]].ok and by_id[ids[2]].ok
    assert by_id[ids[1]].code == "not_a_draft"
    assert by_id["prog.loops~gen-missing"].code == "practical_not_found"


def test_a_draft_with_a_failed_check_is_left_out_of_a_bulk_approval(course) -> None:
    good = Setup(course).reply_for(1)
    bad = [
        reply(reference_solution="public class Main { static void main(){} } COMPILE_ERROR"),
        "[]",
    ]
    setup = Setup(course, *good, *bad)
    job = setup.job(2)
    setup.runner.run(job.job_id)
    ids = setup.jobs.get(job.job_id).item_ids

    results = setup.author.approve_many(LECTURER, ids, None)

    assert [r.ok for r in results] == [True, False] and results[1].code == "checks_failed"


def test_the_same_draft_listed_twice_is_approved_once(course) -> None:
    setup, ids = make_drafts(course, 1)

    results = setup.author.approve_many(LECTURER, [ids[0], ids[0]], None)

    assert len(results) == 1 and results[0].ok


def test_drafts_aimed_at_the_same_place_replace_each_other_in_order(course) -> None:
    setup = Setup(course, *Setup(course).reply_for(2))
    place = setup.author.plan_targets(LOOPS, 1)[0]
    job = new_job(LOOPS, [place, place], None, LECTURER)
    setup.jobs.create(job)
    setup.runner.run(job.job_id)
    first, second = setup.jobs.get(job.job_id).item_ids

    results = setup.author.approve_many(LECTURER, [first, second], None)

    assert all(r.ok for r in results)
    current = {e.question.question_id.replace("#", "~") for e in setup.author.catalog().entries()}
    assert second in current and first not in current


def test_several_drafts_are_rejected_in_one_go(course) -> None:
    setup, ids = make_drafts(course, 2)

    results = setup.author.reject_many(LECTURER, ids, "not what I wanted")

    assert all(r.ok for r in results)
    assert {i.status for i in setup.store.all()} == {"rejected"}


@pytest.mark.parametrize("count", [1, 6])
def test_the_largest_and_smallest_batches_plan_cleanly(course, count) -> None:
    assert len(Setup(course).author.plan_targets(LOOPS, count)) == count
