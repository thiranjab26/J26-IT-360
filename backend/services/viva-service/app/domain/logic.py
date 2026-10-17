"""Deterministic policy and conservative, inspectable research hypotheses."""

import re
from statistics import mean

from app.db.tables import now, uid
from app.domain import fluency

# 1.5: stop and skip are spoken commands only when said on their own (12 words or fewer).
# 1.6: the stop command also accepts the ways speech-to-text mishears "viva" (diva, river, ...).
POLICY_VERSION = "c04-policy-1.6-misheard-viva"
GAP_VERSION = "c04-gap-1.4-literature-profile"
# The research's fluency thresholds; switch to the pilot profile after the 16 Oct statistics.
GAP_PROFILE = fluency.LITERATURE_PROFILE
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
        "fluency": metrics.get("fluency"),
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


def clarification_assessment(bank, prior_turns):
    """A request to explain the question is not an answer: nothing new is marked and the credit
    from earlier answers stays as it was (policy 1.4)."""
    last = prior_turns[-1]["assessment"] if prior_turns else None
    return {
        "state": "non_answer",
        "coverage": last["coverage"] if last else 0.0,
        "rubric_hits": [dict(h) for h in last["rubric_hits"]]
        if last
        else [
            {"id": p["id"], "point": p["point"], "covered": False, "level": "none"}
            for p in bank["rubric_points"]
        ],
        "missing_points": list(last["missing_points"])
        if last
        else [p["point"] for p in bank["rubric_points"]],
        "misconceptions": [],
        "reason": "The student asked for the question to be explained, so nothing was marked "
        "and the question was asked again in plainer words.",
        "provider": "rule:clarification",
    }


def next_question(data, current, assessment, action):
    index = current["_concept_index"]
    if action == "CLARIFY":
        # The same question in plainer words, at the same depth: asking is not an answer.
        bank = data["snapshots"][index]
        target = next(
            (p for p in bank["rubric_points"] if p["id"] == current.get("_target_rubric_id")),
            None,
        )
        prompt = (
            f"Let me ask that another way. {target['probe']}"
            if target and target.get("probe")
            else bank["follow_ups"]["non_answer"]
        )
        issued = issue_question(data, index, current["depth"], prompt, action)
        issued["_target_rubric_id"] = current.get("_target_rubric_id")
        return issued, action
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


def fluency_flags(h):
    """Profile measures beyond their threshold; None when unmeasured or under 10 s of speech."""
    f = h.get("fluency")
    if not f or (f.get("speaking_time_s") or 0) < fluency.MIN_PROFILE_SPEECH_S:
        return None
    return fluency.flags(f, GAP_PROFILE)


HESITATION_SIGNALS = {
    # Speed and pausing, judged by the published thresholds the research uses (gap rules 1.4).
    # It replaces the prototype delay and pause thresholds of 1.3, which had no research basis.
    "fluency": lambda h: len(fluency_flags(h) or []) >= GAP_PROFILE["min_flags"],
    # Prototype thresholds for the words; calibrate on pilot data before the main study.
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
    # Two independent signals are required. Fluency is the only timing signal, so two signals
    # always include something heard in the words: timing alone never decides.
    return len(hesitation_signals(turn)) >= 2


def audible_hesitation(turn):
    """High hesitation that includes at least one signal heard in the words, not timing alone."""
    return high_hesitation(turn) and any(s in VERBAL_SIGNALS for s in hesitation_signals(turn))


MEASURES = {  # report wording for the profile measures: label, unit, number format
    "speech_rate_syll_s": ("speech rate", "syll/s", ".2f"),
    "articulation_rate_syll_s": ("articulation rate", "syll/s", ".2f"),
    "mean_length_of_run_syll": ("run length", "syll", ".1f"),
    "mean_silent_pause_ms": ("mean pause", "ms", ".0f"),
}
FLUENCY_THRESHOLD = (
    f"{GAP_PROFILE['min_flags']} or more of: "
    + ", ".join(
        f"{MEASURES[m][0]} {'<' if d == 'below' else '>'} {cut:g} {MEASURES[m][1]}"
        for m, (d, cut) in GAP_PROFILE["rules"].items()
    )
    + f"; needs {fluency.MIN_PROFILE_SPEECH_S:g} s of speech"
)
SIGNAL_INFO = [  # report labels and thresholds, kept beside the tests they describe
    ("fluency", "Speech fluency (literature profile)", FLUENCY_THRESHOLD),
    ("fillers", "Fillers (um, uh, erm, hmm)", "8 or more per 100 words"),
    ("restarts", "Restarts (I mean, sorry, let me start again)", "2 or more"),
    ("hedges", "Hedges (maybe, I think, I guess)", "2 or more"),
]


def fluency_value(h):
    f = h.get("fluency")
    if not f:
        return "not measured"
    beyond = fluency_flags(h)
    if beyond is None:
        return f"not enough speech ({f.get('speaking_time_s') or 0:.0f} s)"
    parts = [
        f"{label} {f[m]:{fmt}} {unit}"
        for m, (label, unit, fmt) in MEASURES.items()
        if m in GAP_PROFILE["rules"] and f.get(m) is not None
    ]
    return ", ".join(parts) + f" ({len(beyond)} of {len(GAP_PROFILE['rules'])} beyond)"


def signal_details(turn):
    """Every hesitation signal of one answer with its value, threshold and whether it counted."""
    if not turn or turn["input_mode"] != "speech":
        return []
    h, counted = turn["hesitation"], set(hesitation_signals(turn))
    values = {
        "fluency": fluency_value(h),
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
    answered = [t for t in turns if not t.get("skipped") and not t.get("clarification")]
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


# Speech-to-text often mishears "viva"; these are the misspellings seen for it.
VIVA = r"(viva|vivas|vivo|vive|veeva|diva|visa|vista|reva|river|fever|beaver|weaver|viber|bieber|test|exam|quiz)"
STOP_INTENT = re.compile(
    r"\b(stop|end|quit|finish|exit)\b.{0,20}\b(session|interview|this|now|here|"
    + VIVA[1:-1]
    + r")\b"
    r"|\bi (do not|don t|dont) want to (answer|continue|do this|go on)\b|\bi want to (stop|quit|end|leave)\b"
    r"|\bno more questions\b|^(stop|stop it|end|end it|i m done|i am done|that s all)$"
)
SKIP_INTENT = re.compile(
    r"^(please )?(skip|pass)( (this|the|it))?( question)?( please)?$|\bnext question\b|\b(can|could) (i|we) skip\b"
    r"|\bi (want|would like) to skip\b|^(let s |lets )?move on$"
)
# Commands must be said on their own: a long answer that mentions "stop" or "next" is an answer.
COMMAND_WORDS = 12


def spoken_command(transcript):
    """'stop' or 'skip' when the whole utterance is a short command (policy 1.5), otherwise None."""
    text = " ".join(re.sub(r"[^a-z0-9 ]", " ", (transcript or "").lower()).split())
    if not text or len(text.split()) > COMMAND_WORDS:
        return None
    return "stop" if STOP_INTENT.search(text) else "skip" if SKIP_INTENT.search(text) else None


def result_label(report):
    """What students and lecturers read. The stored research category never changes: MIXED is
    shown as mixed results when some concept gave a clear result, otherwise as not enough evidence."""
    if not report:
        return None
    if report.get("strong_answers"):
        return "STRONG"
    if report["outcome"] != MIXED:
        return report["outcome"]
    clear = any(c["outcome"] != MIXED or c.get("no_weakness") for c in report.get("concepts", []))
    return "MIXED_RESULTS" if clear else "NOT_ENOUGH_EVIDENCE"


def resource_title(title):
    """'C3 IT1010 Programming basics notes.md' reads as 'IT1010 Programming basics notes'."""
    return re.sub(
        r"\.(md|txt|pdf|docx?|pptx?)$", "", re.sub(r"^C3\s+", "", title), flags=re.I
    ).strip()


STATE_WORDS = {
    "complete": "complete",
    "partial": "partly complete",
    "superficial": "too brief",
    "incorrect": "incorrect",
    "misconception_bearing": "based on a misunderstanding",
    "non_answer": "not an answer",
}
SIGNAL_KEYS = {label: key for key, label, _ in SIGNAL_INFO}


def plan_item(step, reason):
    return {"step": step, "reason": reason}


def study_plan(concepts, needs, resources):
    """Study steps chosen from what each answer missed. Every step carries the reason it was chosen."""
    items = []
    for c in concepts:
        info, name = needs.get(c["concept"]), c["concept"]
        if not info:
            continue
        if info["skipped"]:
            items.append(
                plan_item(
                    f"Learn {name} from the start, then explain it in your own words.",
                    f"You skipped the {name} question, so it was not marked.",
                )
            )
            continue
        if info["misconceptions"]:
            items.append(
                plan_item(
                    f"Fix this idea about {name}: {info['misconceptions'][0].rstrip('.')}.",
                    f"Your answer to the {name} question showed this misunderstanding.",
                )
            )
        if info["missing"]:
            more = len(info["missing"]) - 1
            items.append(
                plan_item(
                    f"Revise {name}. Make sure you can explain: {info['missing'][0].rstrip('.')}.",
                    f"Your answers to the {name} question covered {round(c['rubric_coverage'])}% of the expected "
                    f"points, and this point was missing"
                    + (
                        f" ({more} more {'point' if more == 1 else 'points'} also missing)."
                        if more
                        else "."
                    ),
                )
            )
    items = items[:3]
    if items and resources:
        items.append(
            plan_item(
                f"Read {resources[0]['title']}, then close it and explain these points from memory.",
                "The viva questions were written from this course material.",
            )
        )
    if not items:
        n = len(concepts)
        items = [
            plan_item(
                "Try a new topic next, or explain a fresh example of these ideas to check you can apply them.",
                f"You covered every expected point in {'all ' + str(n) + ' questions' if n > 1 else 'the question'}.",
            )
        ]
    return items


SPEAKING_STEPS = {
    "restarts": "Plan your first sentence before you speak, so you do not need to start again.",
    "hedges": 'When you know the answer, say it directly, without "maybe" or "I think".',
    "fluency": "Practise explaining at an even pace: short sentences, with a short pause between them.",
}


def speaking_plan(concepts, hesitation):
    """Speaking steps chosen from how the answers were spoken, using the same limits as the gap
    rules. Every step carries the reason it was chosen; nothing is added without a reason."""
    if not hesitation.get("available"):
        return [
            plan_item(
                "Answer by speaking next time, even if it feels slower than typing.",
                "You typed every answer, so your speaking could not be measured.",
            )
        ]
    items = []
    fillers = hesitation.get("fillers_per_100_words") or 0
    if fillers >= 4:
        items.append(
            plan_item(
                'When you need time to think, pause silently instead of saying "um" or "uh".',
                f"You used about {fillers:.0f} filler words per 100 words"
                + ("; the viva counts 8 or more as a sign of difficulty." if fillers >= 8 else "."),
            )
        )
    seen = set()
    for c in concepts:
        for signal in c.get("signal_details") or []:
            key = SIGNAL_KEYS.get(signal["signal"])
            if signal["counted"] and key in SPEAKING_STEPS and key not in seen:
                seen.add(key)
                items.append(
                    plan_item(
                        SPEAKING_STEPS[key],
                        f"In your first answer to the {c['concept']} question: {signal['signal'].split(' (')[0].lower()} "
                        f"{signal['value']} (the viva counts {signal['threshold']}).",
                    )
                )
    latency = hesitation.get("response_latency_ms") or 0
    if latency >= 4000:
        items.append(
            plan_item(
                "Start with one short sentence that answers the question, then add the detail.",
                f"On average you waited {latency / 1000:.1f} seconds before your first word.",
            )
        )
    helped = next((c for c in concepts if c["outcome"] == COMMUNICATION), None)
    if helped:
        items.append(
            plan_item(
                f"Practise explaining {helped['concept']} out loud in full sentences, using the technical terms.",
                f"Your first answer to the {helped['concept']} question was "
                f"{STATE_WORDS.get(helped['initial_state'], 'incomplete')}, but after a follow-up it was "
                f"{STATE_WORDS.get(helped['final_state'], 'complete')}: you knew it, but explaining it took more help.",
            )
        )
    if not items:
        items = [
            plan_item(
                "Keep practising out loud: explain one idea for a minute without notes, a few times a week.",
                "None of the speaking measures in this viva reached the levels the viva looks for.",
            )
        ]
    return items[:4]


def build_report(session_id, data):
    concepts, strengths, missing, needs = [], [], [], {}
    conditions = []
    for condition in ("A", "B", "C"):
        outcomes, reasons = [], []
        for index, bank in enumerate(data["snapshots"]):
            turns = [t for t in data["turns"] if t["concept_index"] == index]
            outcome, reason = differentiate(turns, condition)
            outcomes.append(outcome)
            reasons.append(f"{bank['concept']}: {reason}")
            if condition == "C":
                # Requests to explain the question are not answers (policy 1.4).
                turns = [t for t in turns if not t.get("clarification")] or turns
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
                    if last["missing_points"] or last["misconceptions"] or not answered:
                        needs[bank["concept"]] = {
                            "missing": last["missing_points"],
                            "misconceptions": last["misconceptions"],
                            "skipped": not answered,
                        }
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
    resources = [
        {**r, "title": resource_title(r["title"])}
        for r in data["integration_context"]["c03"]["review_resources"]
    ]
    hesitation = aggregate_hesitation(data["turns"])
    study, speaking = study_plan(concepts, needs, resources), speaking_plan(concepts, hesitation)
    report = {
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
        "hesitation": hesitation,
        "study_plan": study,
        "speaking_plan": speaking,
        "improvement_plan": [i["step"] for i in study + speaking],
        "review_resources": resources,
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
    report["result"] = result_label(report)
    return report
