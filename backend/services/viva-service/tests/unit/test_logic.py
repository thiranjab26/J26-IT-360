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
    resource_title,
    result_label,
    speaking_plan,
    study_plan,
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


# Slow, pause-heavy speech: all four pilot-profile measures beyond their thresholds.
SLOW = {
    "speaking_time_s": 20.0,
    "speech_rate_syll_s": 1.5,
    "articulation_rate_syll_s": 2.5,
    "mean_length_of_run_syll": 3.0,
    "mean_silent_pause_ms": 900,
    "silent_pauses": 8,
    "syllables": 30,
}
FLUENT = {
    "speaking_time_s": 20.0,
    "speech_rate_syll_s": 2.9,
    "articulation_rate_syll_s": 3.9,
    "mean_length_of_run_syll": 6.5,
    "mean_silent_pause_ms": 450,
    "silent_pauses": 4,
    "syllables": 52,
}


def evidence(state, coverage, mis=None, scaffolded=False, fluency=SLOW):
    return {
        "assessment": {"state": state, "coverage": coverage, "misconceptions": mis or []},
        "input_mode": "speech",
        "scaffolded": scaffolded,
        "hesitation": hesitation("um I think, uh", "speech", 4000, {"fluency": fluency}),
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


def test_fluency_signal_uses_the_pilot_profile():
    from app.domain.logic import GAP_PROFILE, GAP_VERSION, hesitation_signals

    assert GAP_VERSION == "c04-gap-1.8-pilot-word-signals"
    assert GAP_PROFILE["name"] == "pilot-2026-10"
    # Fluent by the literature (2.2 is above its 1.97) but slow by the pilot (below 2.53).
    between = dict(FLUENT, speech_rate_syll_s=2.2, articulation_rate_syll_s=3.3)
    assert hesitation_signals(evidence("partial", 50, fluency=between)) == ["fluency", "fillers"]
    assert hesitation_signals(evidence("partial", 50)) == ["fluency", "fillers"]
    assert hesitation_signals(evidence("partial", 50, fluency=FLUENT)) == ["fillers"]
    # One measure beyond its threshold is not enough: the profile needs two of four.
    one = dict(FLUENT, mean_silent_pause_ms=900)
    assert hesitation_signals(evidence("partial", 50, fluency=one)) == ["fillers"]
    # Under 10 s of speech the profile does not judge; nor without measures, or when typed.
    short = dict(SLOW, speaking_time_s=8.0)
    assert hesitation_signals(evidence("partial", 50, fluency=short)) == ["fillers"]
    assert hesitation_signals(evidence("partial", 50, fluency=None)) == ["fillers"]
    typed = evidence("partial", 50) | {"input_mode": "text"}
    assert hesitation_signals(typed) == []
    # The old prototype delay signal is gone: a long wait alone counts for nothing.
    slow_start = evidence("partial", 50, fluency=FLUENT)
    slow_start["hesitation"]["response_latency_ms"] = 60000
    assert hesitation_signals(slow_start) == ["fillers"]


def test_fluency_needs_a_verbal_signal_to_decide_communication():
    recovered = [evidence("partial", 50), evidence("complete", 100)]
    assert differentiate(recovered, "C")[0] == COMMUNICATION
    for turn in recovered:  # same slow speech, no filler or hedge in the words
        turn["hesitation"] = hesitation(
            "it is last in first out", "speech", 4000, {"fluency": SLOW}
        )
    assert differentiate(recovered, "C")[0] == MIXED
    recovered = [evidence("partial", 50, fluency=FLUENT), evidence("complete", 100)]
    assert differentiate(recovered, "C")[0] == MIXED  # fluent speech: one filler signal only


def test_result_label_splits_mixed_into_mixed_results_or_not_enough_evidence():
    concept = lambda outcome, fine=False: {"outcome": outcome, "no_weakness": fine}  # noqa: E731
    assert result_label({"outcome": MIXED, "strong_answers": True, "concepts": []}) == "STRONG"
    assert result_label({"outcome": KNOWLEDGE, "concepts": [concept(KNOWLEDGE)]}) == KNOWLEDGE
    named = {"outcome": MIXED, "concepts": [concept(KNOWLEDGE), concept(MIXED, fine=True)]}
    assert result_label(named) == KNOWLEDGE
    mixed = {"outcome": MIXED, "concepts": [concept(KNOWLEDGE), concept(MIXED)]}
    assert result_label(mixed) == "MIXED_RESULTS"
    assert result_label({"outcome": MIXED, "concepts": [concept(MIXED)]}) == "NOT_ENOUGH_EVIDENCE"
    assert result_label(None) is None


def test_plans_come_from_the_evidence_and_say_why():
    concepts = [
        {
            "concept": "Loops",
            "outcome": KNOWLEDGE,
            "rubric_coverage": 25,
            "initial_state": "partial",
            "final_state": "partial",
            "signal_details": [],
        },
        {
            "concept": "Functions",
            "outcome": COMMUNICATION,
            "rubric_coverage": 100,
            "initial_state": "superficial",
            "final_state": "complete",
            "signal_details": [
                {
                    "signal": "Hedges (maybe, I think)",
                    "value": "3",
                    "threshold": "2 or more",
                    "counted": True,
                }
            ],
        },
    ]
    needs = {
        "Loops": {
            "missing": ["An infinite loop never stops.", "A while loop checks first."],
            "misconceptions": [],
            "skipped": False,
        }
    }
    study = study_plan(concepts, needs, [{"title": "IT1010 Control flow notes"}])
    assert study[0]["step"].startswith("Loops: revise the 2 points listed as missing")
    assert "25%" in study[0]["reason"]
    assert "IT1010 Control flow notes" in study[1]["step"]
    skipped = study_plan(
        concepts[:1], {"Loops": {"missing": [], "misconceptions": [], "skipped": True}}, []
    )
    assert skipped[0]["reason"] == "You skipped this question."
    assert (
        study_plan(concepts[1:], {}, [])[0]["reason"]
        == "You covered every expected point in the question."
    )
    spoken = speaking_plan(
        concepts, {"available": True, "fillers_per_100_words": 9, "response_latency_ms": 5200}
    )
    reasons = " ".join(i["reason"] for i in spoken)
    assert "about 9 filler words per 100 words" in reasons and "5.42 or more" in reasons
    assert '"I think" 3 times' in reasons and "5.2 seconds" in reasons
    assert (
        len(spoken) == 4
    )  # fillers, hedges, the slow start, then the follow-up help (capped at 4)
    quiet = speaking_plan(
        concepts[:1], {"available": True, "fillers_per_100_words": 1, "response_latency_ms": 900}
    )
    assert len(quiet) == 1 and quiet[0]["reason"].startswith("None of the speaking measures")
    assert speaking_plan(concepts, {"available": False})[0]["reason"].startswith(
        "You typed every answer"
    )
    assert (
        resource_title("C3 IT1010 Programming basics notes.md") == "IT1010 Programming basics notes"
    )


def test_low_answers_after_a_follow_up_are_a_knowledge_gap():
    from app.domain.logic import result_label

    # Gap rules 1.6: too brief, then "I don't know" twice is a knowledge gap, not mixed.
    probed = [evidence("superficial", 17), evidence("non_answer", 0), evidence("non_answer", 0)]
    assert differentiate(probed, "B")[0] == KNOWLEDGE
    assert differentiate([evidence("non_answer", 0)] * 3, "B")[0] == MIXED
    helped = {"outcome": MIXED, "concepts": [{"outcome": MIXED, "final_state": "complete"}]}
    assert result_label(helped) == "REACHED_WITH_HELP"


def test_gap_rules_1_7_from_the_p00_pilot_viva():
    # 90% covered every time, one point only half credited, with fillers and slow speech: knowledge shown.
    assert differentiate([evidence("partial", 90)] * 3)[0] == COMMUNICATION
    # Half credits lifted the last answer to exactly 50% after a misconception: still a knowledge gap.
    low = [evidence("misconception_bearing", 25, ["reversed"]), evidence("partial", 37.5), evidence("partial", 50)]
    assert differentiate(low)[0] == KNOWLEDGE
    # Repeats and cut-off words count as restarts; fillers between repeats are ignored.
    assert hesitation("we, we, we add them. float has, uh, float has a decimal", "speech")["restart_count"] == 3


def test_gap_rules_1_8_pilot_word_signals_and_unclear_knowledge():
    from app.domain.logic import hesitation_signals, speaking_unclear

    def spoken(text, seconds=20):
        h = hesitation(text, "speech", 1000, {"fluency": {"speaking_time_s": seconds}})
        return {"input_mode": "speech", "hesitation": h}

    # Pilot cut-off 5.42 per 100 words: 2 fillers in 30 words fire; one filler never does.
    words = "a variable stores a value " * 6
    assert "fillers" in hesitation_signals(spoken("uh " + words + "um"))
    assert "fillers" not in hesitation_signals(spoken("uh " + words))
    # Pilot cut-off 0.34 repairs per minute, with at least two repairs.
    assert "restarts" in hesitation_signals(spoken("we, we have float has, float has a decimal"))
    assert "restarts" not in hesitation_signals(spoken("we, we have a float"))
    # Difficulty heard but only 60% covered: shown as knowledge unclear, research category stays mixed.
    unclear = [evidence("partial", 60), evidence("partial", 60)]
    assert differentiate(unclear)[0] == MIXED and speaking_unclear(unclear)
    assert not speaking_unclear([evidence("partial", 90)] * 2)


def test_one_gap_and_the_rest_fine_names_the_gap():
    concepts = [{"outcome": KNOWLEDGE}, {"outcome": MIXED, "no_weakness": True}]
    assert result_label({"outcome": MIXED, "concepts": concepts}) == KNOWLEDGE
    concepts.append({"outcome": COMMUNICATION})
    assert result_label({"outcome": MIXED, "concepts": concepts}) == "MIXED_RESULTS"


def test_speaking_difficulty_with_unclear_knowledge_joins_a_communication_headline():
    concepts = [{"outcome": MIXED, "speaking_unclear": True}, {"outcome": COMMUNICATION}]
    assert result_label({"outcome": MIXED, "concepts": concepts}) == COMMUNICATION
    concepts[1] = {"outcome": KNOWLEDGE}
    assert result_label({"outcome": MIXED, "concepts": concepts}) == "MIXED_RESULTS"
