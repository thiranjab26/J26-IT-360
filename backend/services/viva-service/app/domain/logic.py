"""Deterministic policy and conservative, inspectable research hypotheses."""

import re
from statistics import mean

from app.db.tables import now, uid

POLICY_VERSION = "c04-policy-1.3-skip-stop"
GAP_VERSION = "c04-gap-1.3-verbal-signal"
MIXED = "MIXED_INSUFFICIENT_EVIDENCE"
KNOWLEDGE = "LIKELY_KNOWLEDGE_GAP"
COMMUNICATION = "LIKELY_COMMUNICATION_DIFFICULTY"
ACTIONS = {
    "complete": "NEXT_CONCEPT",
    "partial": "PROBE_MISSING_RUBRIC",
    "superficial": "ASK_REASONING_OR_EXAMPLE",
    "misconception_bearing": "PROBE_MISCONCEPTION",
    "incorrect": "ASK_SIMPLER_OR_PREREQUISITE",
}


def hesitation(transcript, input_mode, latency=None, audio=None):
    from app.domain.disfluency import lexical_metrics

    lexical = lexical_metrics(transcript)
    words = re.findall(r"\b[\w']+\b", transcript.lower())
    fillers = lexical["filler_count"]
    hedges = len(
        re.findall(
            r"\b(?:maybe|perhaps|i think|i guess|i am not sure|i'm not sure)\b", transcript.lower()
        )
    )
    restarts = len(re.findall(r"\b(?:i mean|sorry|let me start again)\b", transcript.lower()))
    spoken = input_mode == "speech"
    metrics = (audio or {}) if spoken else {}
    available = spoken and (latency is not None or any(v is not None for v in metrics.values()))
    return {
        "available": available,
        "response_latency_ms": latency if spoken else None,
        "pause_count": metrics.get("pause_count"),
        "total_pause_ms": metrics.get("total_pause_ms"),
        "average_pause_ms": metrics.get("average_pause_ms"),
        "audio_duration_ms": metrics.get("audio_duration_ms"),
        "long_pause_count": metrics.get("long_pause_count"),
        "filler_count": fillers,
        "fillers_per_100_words": round(fillers / max(len(words), 1) * 100, 2),
        "hedge_count": hedges,
        "restart_count": restarts,
        "notes": ["Text disfluency counts are lexical proxies, not a diagnosis."]
        + (
            [
                "Client supplied speech timing may be an estimate; it has not been independently validated."
            ]
            if available
            else [
                "Acoustic timing unavailable; no pauses or voice-onset latency inferred from typed text or transcript."
            ]
        ),
    }


def policy(state, depth, max_depth, prior_turns):
    if state == "complete":
        return "NEXT_CONCEPT"
    if depth >= max_depth:
        return "DEPTH_LIMIT_NEXT_CONCEPT"
    if state == "non_answer":
        return (
            "SIMPLIFY"
            if any(t["assessment"]["state"] == "non_answer" for t in prior_turns)
            else "REPHRASE"
        )
    return ACTIONS[state]


def issue_question(data, index, depth=0, text=None, action=None):
    bank = data["snapshots"][index]
    return {
        "id": uid(),
        "concept": bank["concept"],
        "question": text or bank["question"],
        "depth": depth,
        "ordinal": index + 1,
        "total_concepts": len(data["snapshots"]),
        "_concept_index": index,
        "_elicitation_action": action or "MAIN_QUESTION",
        "_scaffolded": action in ("ASK_SIMPLER_OR_PREREQUISITE", "SIMPLIFY"),
    }


def next_question(data, current, assessment, action):
    index = current["_concept_index"]
    if action in (
        "NEXT_CONCEPT",
        "DEPTH_LIMIT_NEXT_CONCEPT",
        "REPEATED_PROMPT_NEXT_CONCEPT",
        "SKIPPED_NEXT_CONCEPT",
    ):
        return issue_question(data, index + 1) if index + 1 < len(
            data["snapshots"]
        ) else None, action
    bank = data["snapshots"][index]
    if action == "SIMPLIFY":
        prompt = (
            f"That is okay. Let us try one basic idea about {bank['concept']}: what does it do?"
        )
    else:
        prompt = bank["follow_ups"][assessment["state"]]
    target = None
    if action == "PROBE_MISSING_RUBRIC" and "rubric_hits" in assessment:
        covered = {h["id"] for h in assessment["rubric_hits"] if h["covered"]}
        missing = [p for p in bank["rubric_points"] if p["id"] not in covered and p.get("probe")]
        seen_targets = {
            t.get("target_rubric_id") for t in data["turns"] if t["concept_index"] == index
        }
        target = next(
            (p for p in missing if p["id"] not in seen_targets), missing[0] if missing else None
        )
        if target:
            prompt = target["probe"]
    seen = {t["question"].strip().lower() for t in data["turns"] if t["concept_index"] == index}
    seen.add(current["question"].strip().lower())
    if prompt.strip().lower() in seen:
        # A fixed alternate requests a new example, without revealing facts or looping forever.
        alternate = f"Use a different concrete example to explain {bank['concept']}. Work through your reasoning step by step."
        if alternate.lower() in seen:
            return next_question(data, current, assessment, "REPEATED_PROMPT_NEXT_CONCEPT")
        prompt = alternate
        target = None
    issued = issue_question(data, index, current["depth"] + 1, prompt, action)
    issued["_target_rubric_id"] = target["id"] if target else None
    return issued, action


HESITATION_SIGNALS = {  # prototype thresholds; calibrate on pilot data before the main study
    "latency": lambda h: (h.get("response_latency_ms") or 0) >= 3000,
    # Judged by pause length, not total: a total grows with answer length (gap rules 1.3).
    "pauses": lambda h: (
        (h.get("average_pause_ms") or 0) >= 1500 or (h.get("long_pause_count") or 0) >= 3
    ),
    "fillers": lambda h: h.get("fillers_per_100_words", 0) >= 8,
    "restarts": lambda h: h.get("restart_count", 0) >= 2,
    "hedges": lambda h: h.get("hedge_count", 0) >= 2,
}


def hesitation_signals(turn):
    if turn["input_mode"] != "speech":
        return []
    return [name for name, test in HESITATION_SIGNALS.items() if test(turn["hesitation"])]


VERBAL_SIGNALS = ("fillers", "hedges", "restarts")


def high_hesitation(turn):
    # Two independent signals are required: one slow start or a single 'um' is not evidence on its own.
    return len(hesitation_signals(turn)) >= 2


def audible_hesitation(turn):
    """High hesitation that includes at least one signal heard in the words, not timing alone."""
    return high_hesitation(turn) and any(s in VERBAL_SIGNALS for s in hesitation_signals(turn))


SIGNAL_INFO = [  # report labels and thresholds, kept beside the tests they describe
    ("latency", "Delay before the first word, after pressing record", "3,000 ms or more"),
    ("pauses", "Pauses", "average 1.5 s or more, or 3+ pauses over 2 s"),
    ("fillers", "Fillers (um, uh, erm, hmm)", "8 or more per 100 words"),
    ("restarts", "Restarts (I mean, sorry, let me start again)", "2 or more"),
    ("hedges", "Hedges (maybe, I think, I guess)", "2 or more"),
]


def signal_details(turn):
    """Every hesitation signal of one answer with its value, threshold and whether it counted."""
    if not turn or turn["input_mode"] != "speech":
        return []
    h, counted = turn["hesitation"], set(hesitation_signals(turn))
    values = {
        "latency": f"{h['response_latency_ms']:,.0f} ms"
        if h.get("response_latency_ms") is not None
        else "not measured",
        "pauses": (
            f"average {(h.get('average_pause_ms') or 0) / 1000:.1f} s"
            + (
                f", {h['long_pause_count']} over 2 s"
                if h.get("long_pause_count") is not None
                else ""
            )
        ),
        "fillers": f"{h.get('fillers_per_100_words', 0)} per 100 words",
        "restarts": str(h.get("restart_count", 0)),
        "hedges": str(h.get("hedge_count", 0)),
    }
    return [
        {"signal": label, "value": values[key], "threshold": threshold, "counted": key in counted}
        for key, label, threshold in SIGNAL_INFO
    ]


def differentiate(turns, condition="C"):
    """Gap outcome from viva evidence only; C01 mastery is reference evidence for raters, not an input."""
    answered = [t for t in turns if not t.get("skipped")]
    evidence = answered[:1] if condition == "A" else answered
    if not evidence:
        return MIXED, (
            "The student skipped this concept; no answer evidence was recorded."
            if turns
            else "No answer evidence was recorded for this concept."
        )
    first, last = evidence[0]["assessment"], evidence[-1]["assessment"]
    shown = (
        last["state"] == "complete"
        and last["coverage"] >= 80
        and not any(t.get("scaffolded", False) for t in evidence[1:])
    )
    if (
        condition == "C"
        and first["state"] == "complete"
        and shown
        and audible_hesitation(evidence[0])
    ):
        return COMMUNICATION, (
            "The answer covered the rubric without teaching prompts, but the spoken delivery showed several hesitation signals ("
            + ", ".join(hesitation_signals(evidence[0]))
            + "); knowledge appears present while expressing it was difficult."
        )
    if first["state"] == "complete":
        return (
            MIXED,
            "The initial answer covers the assessed rubric. No weakness requiring knowledge-gap or communication attribution was observed.",
        )
    if condition == "A":
        # Content-only baseline: judge the first answer alone.
        if first["state"] in ("incorrect", "misconception_bearing", "non_answer"):
            return (
                KNOWLEDGE,
                "The initial answer was incorrect, held a misconception, or gave no answer (initial answer content only).",
            )
        return (
            MIXED,
            "The initial answer was partly correct; answer content alone cannot attribute the weakness.",
        )
    if len(evidence) == 1:
        return (
            MIXED,
            "Only one answer was recorded for this concept; no follow-up evidence is available.",
        )
    substantive = [t for t in evidence if t["assessment"]["state"] != "non_answer"]
    misconceptions = [set(t["assessment"]["misconceptions"]) for t in substantive]
    persistent = len(misconceptions) >= 2 and bool(misconceptions[-1] & misconceptions[-2])
    low_repeated = len(substantive) >= 2 and all(
        t["assessment"]["coverage"] < 50
        and t["assessment"]["state"]
        in ("incorrect", "misconception_bearing", "partial", "superficial")
        for t in substantive[-2:]
    )
    if persistent:
        return KNOWLEDGE, "A misconception persisted across substantive responses."
    if low_repeated:
        return (
            KNOWLEDGE,
            "Rubric coverage remained below 50% across two substantive responses after probing.",
        )
    recovered = last["state"] == "complete" and last["coverage"] >= 80
    scaffolded = any(t.get("scaffolded", False) for t in evidence[1:])
    if recovered and scaffolded:
        return (
            MIXED,
            "The answer improved after simplification or potentially teaching prompts; this cannot establish pre-existing knowledge.",
        )
    if recovered:
        repeated_recovery = len(evidence) >= 3 and all(
            t["assessment"]["coverage"] >= 66
            and t["assessment"]["state"] in ("partial", "complete")
            for t in evidence[-2:]
        )
        if repeated_recovery:
            return (
                COMMUNICATION,
                "After a weak initial answer, two non-teaching follow-up responses showed substantial then complete rubric knowledge.",
            )
        if condition == "C" and high_hesitation(evidence[0]):
            return (
                COMMUNICATION,
                "A weak initial spoken answer became complete after one non-teaching follow-up, and supplementary hesitation evidence supports difficulty expressing the answer.",
            )
        return (
            MIXED,
            "One non-teaching follow-up revealed the knowledge, but this evidence condition does not establish a communication-specific difficulty.",
        )
    return (
        MIXED,
        "Evidence is incomplete, conflicting, or insufficient to attribute the difficulty reliably.",
    )


def aggregate_outcome(outcomes):
    if outcomes and all(v == KNOWLEDGE for v in outcomes):
        return KNOWLEDGE
    if outcomes and all(v == COMMUNICATION for v in outcomes):
        return COMMUNICATION
    return MIXED


def aggregate_hesitation(turns):
    values = [t["hesitation"] for t in turns]
    result = {
        "available": any(v["available"] for v in values),
        "notes": [
            "Hesitation is supplementary evidence only. Lexical fillers/hedges are proxies; missing acoustic data remains null."
        ],
    }
    for key in ("response_latency_ms", "average_pause_ms"):
        present = [v[key] for v in values if v.get(key) is not None]
        result[key] = round(mean(present), 2) if present else None
    for key in ("pause_count", "total_pause_ms", "audio_duration_ms"):
        present = [v[key] for v in values if v.get(key) is not None]
        result[key] = sum(present) if present else None
    for key in ("filler_count", "hedge_count", "restart_count"):
        result[key] = sum(v[key] for v in values)
    words = sum(len(t["transcript"].split()) for t in turns)
    result["fillers_per_100_words"] = round(result["filler_count"] / max(words, 1) * 100, 2)
    return result


def build_report(session_id, data):
    concepts, strengths, missing = [], [], []
    conditions = []
    for condition in ("A", "B", "C"):
        outcomes, reasons = [], []
        for index, bank in enumerate(data["snapshots"]):
            turns = [t for t in data["turns"] if t["concept_index"] == index]
            outcome, reason = differentiate(turns, condition)
            outcomes.append(outcome)
            reasons.append(f"{bank['concept']}: {reason}")
            if condition == "C":
                last = turns[-1]["assessment"] if turns else None
                answered = [t for t in turns if not t.get("skipped")]
                concepts.append(
                    {
                        "concept": bank["concept"],
                        "outcome": outcome,
                        "explanation": reason,
                        "no_weakness": outcome == MIXED
                        and bool(answered)
                        and answered[0]["assessment"]["state"] == "complete",
                        "signal_details": signal_details(answered[0] if answered else None),
                        "initial_state": turns[0]["assessment"]["state"] if turns else None,
                        "final_state": last["state"] if last else None,
                        "rubric_coverage": last["coverage"] if last else 0,
                        "turn_count": len(turns),
                    }
                )
                if last:
                    strengths.extend(h["point"] for h in last["rubric_hits"] if h["covered"])
                    missing.extend(last["missing_points"])
                else:
                    missing.append(f"{bank['concept']}: not assessed")
        conditions.append(
            {
                "condition": condition,
                "outcome": aggregate_outcome(outcomes),
                "explanation": " ".join(reasons),
            }
        )
    outcome = conditions[-1]["outcome"]
    mismatch = data["integration_context"]["c01"]["mastery"] >= 80 and any(
        c["outcome"] == KNOWLEDGE for c in concepts
    )
    c03_mock = data["integration_context"]["c03"]["source"].startswith("mock")
    events = [
        {
            "component": "C03",
            "event": "review_resources",
            "status": "mock" if c03_mock else "retrieved",
            "detail": "Sample course resources retrieved from the mock adapter."
            if c03_mock
            else "Course resources retrieved from the configured C03 API.",
        }
    ]
    if data["integration_context"]["c03"]["source"].startswith("local uploaded"):
        events[0].update(
            status="local_materials",
            detail="Source excerpts were loaded from locally authored course materials in the configured database.",
        )
    if mismatch:
        from app.config import settings

        c01_mock = data["integration_context"]["c01"]["source"].startswith("mock")
        queued = bool(settings().c01_review_url) and not c01_mock
        events.append(
            {
                "component": "C01",
                "event": "mastery_review_requested",
                "status": "queued"
                if queued
                else ("mock_not_sent" if c01_mock else "recorded_not_sent"),
                "detail": "Queued for the configured C01 review endpoint after session persistence."
                if queued
                else "A review notification is recorded locally only. C01 mastery is unchanged; no external message was sent.",
            }
        )
    if outcome == COMMUNICATION:
        plan = [
            "Structure explanations as definition → principle → reasoning → example.",
            "Practise a 30-second spoken explanation, then review the transcript.",
        ]
    elif any(c["outcome"] == KNOWLEDGE for c in concepts):
        plan = [
            "Review the listed missing concepts in the C03 course notes.",
            "Work through two examples and explain each step before retrying the viva.",
        ]
    elif concepts and all(c["initial_state"] == "complete" for c in concepts):
        plan = [
            "Move on to another topic, or explain a new example to check that you can apply these ideas.",
            "Revisit the concepts later to check retention.",
        ]
    else:
        plan = [
            "Review the concept-level evidence and any unassessed points.",
            "Retake the viva on these concepts to collect more spoken evidence before attributing a gap.",
        ]
    return {
        "session_id": session_id,
        "topic": data["topic"],
        "created_at": now(),
        "outcome": outcome,
        # Student-facing only: the stored research category stays MIXED.
        "strong_answers": bool(concepts) and all(c["no_weakness"] for c in concepts),
        "explanation": conditions[-1]["explanation"],
        "rubric_coverage": round(mean(c["rubric_coverage"] for c in concepts), 1),
        "strengths": list(dict.fromkeys(strengths)),
        "missing_concepts": list(dict.fromkeys(missing)),
        "concepts": concepts,
        "hesitation": aggregate_hesitation(data["turns"]),
        "improvement_plan": plan,
        "review_resources": data["integration_context"]["c03"]["review_resources"],
        "mastery_mismatch": mismatch,
        "integration_events": events,
        "evidence_conditions": conditions,
        "limitations": [
            "Research prototype; no measured accuracy is claimed before independent validation.",
            (
                "Demo assessments use phrase matching and can miss paraphrases, contradictions, or subtle misconceptions."
                if any(t["assessment"]["provider"].startswith("demo") for t in data["turns"])
                else "LLM rubric assessments can be wrong and require independent human validation."
            ),
            "Integration provenance is shown per component. Mock context never counts as independent learner evidence.",
            "No-evident-gap and insufficient-evidence cases share the required mixed category; read the explanation.",
            "A judges the first answer alone; B may support communication after two non-teaching recovery probes; C may supplement one recovery probe with hesitation. These are unvalidated research hypotheses, not proven benefits.",
            "A/B/C reuse recorded turns; this is a retrospective evidence ablation, not a randomized intervention.",
        ],
    }
