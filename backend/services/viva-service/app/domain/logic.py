"""Deterministic policy and conservative, inspectable research hypotheses."""

import re
from statistics import mean
from types import SimpleNamespace

from app.db.tables import now, uid
from app.domain import fluency

# 1.5: stop and skip are spoken commands only when said on their own (12 words or fewer).
# 1.6: the stop command also accepts the ways speech-to-text mishears "viva" (diva, river, ...).
POLICY_VERSION = "c04-policy-1.6-misheard-viva"
# 1.5: the fluency thresholds are the pilot profile (from the 10 PP1 students), not the literature.
# 1.6: answers that stay below half the points after a follow-up are a knowledge gap, even when
# the later answers are "I don't know".
GAP_VERSION = "c04-gap-1.10-pilot-signals-only"
GAP_PROFILE = fluency.PILOT_PROFILE
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
    # 1.7: restarts are the research repair counts (repeats like "we, we", cut-off words, "sorry, I mean").
    repair = fluency.repairs([SimpleNamespace(text=t) for t in transcript.split()])
    restarts = repair["repetitions"] + repair["false_starts"] + repair["self_corrections"]
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
            else f"Let me ask that again. {current['question']}"
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


# Pilot cut-offs for the word signals (results/report.md, 17 Oct 2026, best cut-off on the 5 + 5
# students), counted here from the live transcript, which hears fewer fillers than the study's CrisperWhisper.
PILOT_FILLERS_PER_100_WORDS = 5.42  # filled pauses per 100 words, p = 0.016
PILOT_REPAIRS_PER_MIN = 0.34  # repeats, false starts and self-corrections per minute, p = 0.139 (exploratory)


def repairs_per_minute(h):
    """Repairs per minute of speech; None under 10 s of speech, like the speed measures."""
    seconds = (h.get("fluency") or {}).get("speaking_time_s") or 0
    if seconds < fluency.MIN_PROFILE_SPEECH_S:
        return None
    return h.get("restart_count", 0) / (seconds / 60)


HESITATION_SIGNALS = {
    # Speed and pausing, judged by the pilot thresholds (gap rules 1.5; 1.4 used the literature).
    # It replaces the prototype delay and pause thresholds of 1.3, which had no research basis.
    "fluency": lambda h: len(fluency_flags(h) or []) >= GAP_PROFILE["min_flags"],
    # 1.8: fillers and repairs use the pilot cut-offs. The pilot rates come from whole vivas; one
    # answer is short, so a single "um" or "sorry" never counts alone. 1.10: hedges ("maybe", "I think")
    # left the decision: not measured in the pilot, and as likely to show doubt about the answer as a
    # language difficulty. hedge_count is still stored.
    "fillers": lambda h: h.get("filler_count", 0) >= 2
    and h.get("fillers_per_100_words", 0) >= PILOT_FILLERS_PER_100_WORDS,
    "restarts": lambda h: h.get("restart_count", 0) >= 2
    and (repairs_per_minute(h) or 0) >= PILOT_REPAIRS_PER_MIN,
}


def hesitation_signals(turn):
    if turn["input_mode"] != "speech":
        return []
    return [name for name, test in HESITATION_SIGNALS.items() if test(turn["hesitation"])]


VERBAL_SIGNALS = ("fillers", "restarts")


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
    f"Slower or more paused than typical on {GAP_PROFILE['min_flags']} of the "
    f"{len(GAP_PROFILE['rules'])} speed and pause measures (needs "
    f"{fluency.MIN_PROFILE_SPEECH_S:g} s of speech)"
)
SIGNAL_INFO = [  # report labels and thresholds, kept beside the tests they describe
    ("fluency", "Speed and pauses", FLUENCY_THRESHOLD),
    (
        "fillers",
        "Filler words (um, uh)",
        f"{PILOT_FILLERS_PER_100_WORDS:g} or more per 100 words (pilot cut-off), at least 2",
    ),
    (
        "restarts",
        "Repeats and restarts (we, we; sorry, I mean)",
        f"{PILOT_REPAIRS_PER_MIN:g} or more per minute of speech (pilot cut-off, exploratory), at least 2",
    ),
]
SIGNAL_NAMES = {key: label for key, label, _ in SIGNAL_INFO}


def fluency_value(h):
    f = h.get("fluency")
    if not f:
        return "not measured"
    beyond = fluency_flags(h)
    if beyond is None:
        return f"too short to measure ({f.get('speaking_time_s') or 0:.0f} s of speech)"
    if not beyond:
        return "typical"
    return (
        f"slower or more paused than typical on {len(beyond)} of {len(GAP_PROFILE['rules'])}: "
        + ", ".join(MEASURES[m][0] for m in beyond)
    )


def signal_details(turn):
    """Every hesitation signal of one answer with its value, threshold and whether it counted."""
    if not turn or turn["input_mode"] != "speech":
        return []
    h, counted = turn["hesitation"], set(hesitation_signals(turn))
    values = {
        "fluency": fluency_value(h),
        "fillers": f"{h.get('fillers_per_100_words', 0)} per 100 words",
        "restarts": f"{h.get('restart_count', 0)} ("
        + (f"{rate:.2f} per minute)" if (rate := repairs_per_minute(h)) is not None else "under 10 s of speech)"),
    }
    return [
        {"signal": label, "value": values[key], "threshold": threshold, "counted": key in counted}
        for key, label, threshold in SIGNAL_INFO
    ]


def knows(assessment):
    """1.7: 80% of the points or more shows the knowledge, even when one point got only half credit."""
    return assessment["state"] in ("partial", "complete") and assessment["coverage"] >= 80


def speaking_unclear(turns):
    """1.8: difficulty heard in the speech, but only 51 to 79% of the points came through, so the
    viva cannot say whether knowledge or explaining held the answer back. Shown to people; the
    research category stays MIXED."""
    answered = [t for t in turns if not t.get("skipped") and not t.get("clarification")]
    best = max((t["assessment"]["coverage"] for t in answered), default=0)
    return 50 < best < 80 and any(audible_hesitation(t) for t in answered)


def differentiate(turns, condition="C"):
    """Gap outcome from viva evidence only; C01 mastery is reference evidence for raters, not an input."""
    answered = [t for t in turns if not t.get("skipped") and not t.get("clarification")]
    evidence = answered[:1] if condition == "A" else answered
    if not evidence:
        return MIXED, (
            "This question was skipped, so it was not marked."
            if turns
            else "This question was not reached."
        )
    first, last = evidence[0]["assessment"], evidence[-1]["assessment"]
    shown = knows(last) and not any(t.get("scaffolded", False) for t in evidence[1:])
    if (
        condition == "C"
        and knows(first)
        and shown
        and audible_hesitation(evidence[0])
    ):
        return COMMUNICATION, (
            "The answer covered the expected points, but the speech showed signs of difficulty ("
            + ", ".join(SIGNAL_NAMES[s].lower() for s in hesitation_signals(evidence[0]))
            + "): the knowledge is there; explaining it was the hard part."
        )
    if knows(first):
        return (
            MIXED,
            "The first answer covered the expected points. No weakness was found.",
        )
    if condition == "A":
        # Content-only baseline: judge the first answer alone.
        if first["state"] in ("incorrect", "misconception_bearing", "non_answer"):
            return (
                KNOWLEDGE,
                "The first answer was incorrect, held a misunderstanding, or gave no answer (first answer only).",
            )
        return (
            MIXED,
            "The first answer was partly correct; the first answer alone cannot say why.",
        )
    if len(evidence) == 1:
        return (
            MIXED,
            "Only one answer was given, so there is not enough to judge.",
        )
    substantive = [t for t in evidence if t["assessment"]["state"] != "non_answer"]
    misconceptions = [set(t["assessment"]["misconceptions"]) for t in substantive]
    persistent = len(misconceptions) >= 2 and bool(misconceptions[-1] & misconceptions[-2])
    low_repeated = len(substantive) >= 2 and all(
        t["assessment"]["coverage"] <= 50
        and t["assessment"]["state"]
        in ("incorrect", "misconception_bearing", "partial", "superficial")
        for t in substantive[-2:]
    )
    # 1.6: still at most half the points after a follow-up (1.7: half credits can land exactly on 50),
    # with at least one real attempt; answers that are all "I don't know" stay mixed.
    probed_low = bool(substantive) and all(t["assessment"]["coverage"] <= 50 for t in evidence)
    if persistent:
        return KNOWLEDGE, "The same misunderstanding came back after the follow-up question."
    if low_repeated or probed_low:
        return (
            KNOWLEDGE,
            "The answers stayed at or below half of the expected points, even after follow-up questions.",
        )
    recovered = knows(last)
    scaffolded = any(t.get("scaffolded", False) for t in evidence[1:])
    if recovered and scaffolded:
        return (
            MIXED,
            "The full answer came only after the question was made simpler, so it cannot show the knowledge was there before.",
        )
    if recovered:
        repeated_recovery = len(evidence) >= 3 and all(
            t["assessment"]["coverage"] >= 66
            and t["assessment"]["state"] in ("partial", "complete")
            for t in evidence[-2:]
        )
        # 1.9: the recovery shows the knowledge; in the full condition C a communication result also
        # needs difficulty heard in the speech, so a fluent student who only needed prompting reads as
        # reached with help. Condition B (content and follow-ups only, no speech) keeps the old rule.
        if repeated_recovery and (condition == "B" or any(audible_hesitation(t) for t in evidence)):
            return (
                COMMUNICATION,
                "The first answer was weak, but two follow-up questions that taught nothing brought out the full answer, and the speech showed signs of difficulty: the knowledge is there; explaining it was the hard part.",
            )
        if condition == "C" and high_hesitation(evidence[0]):
            return (
                COMMUNICATION,
                "The first spoken answer was weak but became complete after one follow-up, and the speech showed signs of difficulty.",
            )
        return (
            MIXED,
            "A follow-up question brought out the full answer, but that alone does not show a communication difficulty.",
        )
    return (
        MIXED,
        "The answers were mixed, so the viva cannot say whether the problem was knowledge or explaining.",
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
    concepts = report.get("concepts", [])
    # Every point reached, but only after follow-ups: not "not enough evidence".
    if concepts and all(c.get("final_state") == "complete" or c.get("rubric_coverage", 0) >= 80 for c in concepts):
        return "REACHED_WITH_HELP"
    if concepts and all(c.get("speaking_unclear") for c in concepts):
        return "SPEAKING_DIFFICULTY_SEEN"
    # One kind of gap and every other topic fine: name the gap, not "mixed". Speaking difficulty with
    # unclear knowledge points the same way as a communication difficulty, so it does not mix with it.
    gaps = {c["outcome"] for c in concepts if c["outcome"] != MIXED}

    def settled(c):
        return (
            c["outcome"] != MIXED
            or c.get("no_weakness")
            or (c.get("speaking_unclear") and gaps == {COMMUNICATION})
        )

    if len(gaps) == 1 and all(settled(c) for c in concepts):
        return gaps.pop()
    clear = any(c["outcome"] != MIXED or c.get("no_weakness") or c.get("speaking_unclear") for c in concepts)
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
                    f"{name}: learn it from the start, then explain it in your own words.",
                    "You skipped this question.",
                )
            )
            continue
        if info["misconceptions"]:
            items.append(
                plan_item(
                    f"{name}: correct this idea: {info['misconceptions'][0].rstrip('.')}.",
                    "Your answer showed this misunderstanding.",
                )
            )
        if info["missing"]:
            n = len(info["missing"])
            items.append(
                plan_item(
                    f"{name}: revise the {'point' if n == 1 else f'{n} points'} listed as missing "
                    "under this topic, then explain them out loud in your own words.",
                    f"Your answers covered {int(c['rubric_coverage'] + 0.5)}% of the expected points.",
                )
            )
    items = items[:3]
    if items and resources:
        items.append(
            plan_item(
                f"Read {resources[0]['title']}, then explain the missing points from memory.",
                "The questions came from this material.",
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


SPEAKING_REASONS = {  # why each speaking step was chosen, in words a student follows
    "fluency": "In your first answer about {concept}, you spoke more slowly and paused for longer "
    "than students who find English vivas easy.",
    "restarts": "In your first answer about {concept}, you repeated words or started again: {n}.",
}
SPEAKING_STEPS = {
    "restarts": "Plan your first sentence before you speak, so you do not need to start again.",
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
                + (
                    f"; the viva counts {PILOT_FILLERS_PER_100_WORDS:g} or more as a sign of difficulty."
                    if fillers >= PILOT_FILLERS_PER_100_WORDS
                    else "."
                ),
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
                        SPEAKING_REASONS[key].format(concept=c["concept"], n=signal["value"]),
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
                (
                    f"Your answer to the {helped['concept']} question covered the expected points, but it was "
                    "slow and hesitant: you knew it; saying it out loud was the hard part."
                )
                if helped["initial_state"] == "complete" or helped.get("turn_count") == 1
                else (
                    f"Your first answer to the {helped['concept']} question was "
                    f"{STATE_WORDS.get(helped['initial_state'], 'incomplete')}, but after a follow-up it was "
                    f"{STATE_WORDS.get(helped['final_state'], 'complete')}: you knew it, but explaining it took more help."
                ),
            )
        )
    if not items:
        items = [
            plan_item(
                "Your speaking was clear in this viva. Keep it up: explain one idea out loud for a minute "
                "without notes, a few times a week.",
                "",  # nothing was flagged, so a friendly tip with no "why"
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
            unclear = condition == "C" and outcome == MIXED and speaking_unclear(turns)
            if unclear:
                reason = (
                    "Signs of speaking difficulty were heard, but only part of the expected points came "
                    "through, so it is not clear whether knowledge or explaining held the answer back."
                )
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
                        "speaking_unclear": unclear,
                        "no_weakness": outcome == MIXED
                        and bool(answered)
                        and answered[0]["assessment"]["state"] == "complete",
                        "signal_details": signal_details(answered[0] if answered else None),
                        "initial_state": turns[0]["assessment"]["state"] if turns else None,
                        "final_state": last["state"] if last else None,
                        "rubric_coverage": last["coverage"] if last else 0,
                        "turn_count": len(turns),
                        "covered": [h["point"] for h in last["rubric_hits"] if h["covered"]]
                        if last
                        else [],
                        "missing": list(last["missing_points"]) if last else [],
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
