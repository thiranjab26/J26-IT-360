import pytest

from app.domain.logic import (
    COMMUNICATION,
    KNOWLEDGE,
    MIXED,
    differentiate,
    hesitation,
    issue_question,
    next_question,
    policy,
)
from app.domain.seed import seed_questions
from app.integrations.llm import demo_assess


@pytest.mark.parametrize(
    "text,state",
    [
        ("LIFO means last in first out. B is removed first.", "complete"),
        ("The last item added leaves first.", "partial"),
        ("LIFO", "superficial"),
        ("It sorts all values alphabetically.", "incorrect"),
        ("A stack follows FIFO, first in first out.", "misconception_bearing"),
        ("I don't know", "non_answer"),
    ],
)
def test_six_demo_states(text, state):
    assert demo_assess(seed_questions()[0], text)["state"] == state


def test_negated_misconception_not_detected():
    result = demo_assess(
        seed_questions()[0],
        "A stack does not follow FIFO. LIFO means last in first out and B is removed first.",
    )
    assert result["state"] == "complete"
    assert not result["misconceptions"]


def test_followup_uses_prior_hits_and_only_actual_rubric():
    q = seed_questions()[0]
    first = demo_assess(q, "The last item added comes out first.")
    hits = [h["id"] for h in first["rubric_hits"] if h["covered"]]
    final = demo_assess(q, "For A then B, B is removed first.", hits)
    assert final["state"] == "complete"
    assert len(final["rubric_hits"]) == 2  # No unasked 'linear data structure' penalty.


def test_policy_depth_and_nonanswer_sequence():
    assert policy("non_answer", 0, 2, []) == "REPHRASE"
    prior = [{"assessment": {"state": "non_answer"}}]
    assert policy("non_answer", 1, 2, prior) == "SIMPLIFY"
    assert policy("non_answer", 2, 2, prior) == "DEPTH_LIMIT_NEXT_CONCEPT"
    assert policy("complete", 2, 2, prior) == "NEXT_CONCEPT"
    expected = {
        "partial": "PROBE_MISSING_RUBRIC",
        "superficial": "ASK_REASONING_OR_EXAMPLE",
        "incorrect": "ASK_SIMPLER_OR_PREREQUISITE",
        "misconception_bearing": "PROBE_MISCONCEPTION",
    }
    for state, action in expected.items():
        assert policy(state, 0, 2, []) == action


def test_repeat_prompt_bounded_and_issued_ids_unique():
    q = seed_questions()[0]
    data = {"snapshots": [q], "turns": []}
    current = issue_question(data, 0)
    follow, _ = next_question(data, current, {"state": "partial"}, "PROBE_MISSING_RUBRIC")
    assert follow["id"] != current["id"]
    data["turns"].append({"concept_index": 0, "question": follow["question"]})
    alternate, _ = next_question(data, follow, {"state": "partial"}, "PROBE_MISSING_RUBRIC")
    assert alternate["question"] != follow["question"]
    data["turns"].append({"concept_index": 0, "question": alternate["question"]})
    final, action = next_question(data, alternate, {"state": "partial"}, "PROBE_MISSING_RUBRIC")
    assert final is None
    assert action == "REPEATED_PROMPT_NEXT_CONCEPT"


def evidence(state, coverage, mis=None, scaffolded=False, latency=4000):
    return {
        "assessment": {"state": state, "coverage": coverage, "misconceptions": mis or []},
        "input_mode": "speech",
        "scaffolded": scaffolded,
        "hesitation": hesitation("um I think", "speech", latency),
    }


def test_persistent_misconceptions_and_no_nonanswer_diagnosis():
    turns = [
        evidence("misconception_bearing", 0, ["FIFO"]),
        evidence("misconception_bearing", 0, ["FIFO"]),
    ]
    assert (
        differentiate(turns, "A")[0] == KNOWLEDGE
    )  # content-only baseline judges the first answer
    assert differentiate(turns, "B")[0] == KNOWLEDGE
    assert differentiate([evidence("non_answer", 0)] * 3)[0] == MIXED
    assert differentiate([evidence("partial", 50)] * 2, "A")[0] == MIXED


def test_ablation_has_real_evidence_separation_and_teaching_guard():
    turns = [evidence("partial", 50), evidence("complete", 100)]
    assert differentiate(turns, "A")[0] == MIXED
    assert differentiate(turns, "B")[0] == MIXED
    assert differentiate(turns, "C")[0] == COMMUNICATION
    turns[1]["scaffolded"] = True
    assert differentiate(turns, "C")[0] == MIXED
    turns[1]["scaffolded"] = False
    turns[0]["input_mode"] = "text"  # no acoustic hesitation evidence
    assert differentiate(turns, "C")[0] == MIXED
    turns = [evidence("partial", 30), evidence("partial", 67), evidence("complete", 100)]
    assert differentiate(turns, "B")[0] == COMMUNICATION


def test_typed_acoustics_not_fabricated_or_used():
    result = hesitation("um I think maybe", "text", 4000, {"pause_count": 8})
    assert result["response_latency_ms"] is None
    assert result["pause_count"] is None
    assert result["filler_count"] == 1
    assert result["available"] is False


def test_complete_initial_answer_explains_absence_of_weakness():
    outcome, reason = differentiate([evidence("complete", 100)], "B")
    assert outcome == MIXED
    assert "No weakness" in reason
