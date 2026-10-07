"""Blinded evidence and explicitly paired, condition-specific research metrics."""

import math
from itertools import combinations
from statistics import mean

from sqlalchemy import select

from app.db.tables import HumanRating, VivaSession
from app.domain.logic import differentiate

STATES = ["complete", "partial", "superficial", "incorrect", "misconception_bearing", "non_answer"]
GAPS = ["LIKELY_KNOWLEDGE_GAP", "LIKELY_COMMUNICATION_DIFFICULTY", "MIXED_INSUFFICIENT_EVIDENCE"]


def cases(db, condition, rater_id):
    result = []
    ratings = {
        r.case_id: r.data
        for r in db.scalars(
            select(HumanRating).where(
                HumanRating.rater_id == rater_id, HumanRating.condition == condition
            )
        )
    }
    for session in db.scalars(select(VivaSession).where(VivaSession.status == "completed")):
        data = session.data
        for index, bank in enumerate(data["snapshots"]):
            recorded = [t for t in data["turns"] if t["concept_index"] == index]
            if not recorded:
                continue
            turns = recorded[:1] if condition == "A" else recorded
            case_id = f"{session.id}:{index}"
            evidence = []
            for t in turns:
                item = {k: t[k] for k in ("id", "question", "transcript", "depth", "input_mode")}
                if condition == "C":
                    item["hesitation"] = t["hesitation"]
                evidence.append(item)
            result.append(
                {
                    "case_id": case_id,
                    "session_id": session.id,
                    "topic": data["topic"],
                    "concept": bank["concept"],
                    "condition": condition,
                    "c01_mastery": {
                        k: data["integration_context"]["c01"].get(k)
                        for k in ("mastery", "confidence", "source")
                    },
                    "turns": evidence,
                    "my_rating": ratings.get(case_id),
                }
            )
    return result


def prediction(db, case_id, condition):
    try:
        session_id, index_str = case_id.rsplit(":", 1)
        index = int(index_str)
    except (ValueError, AttributeError):
        return None
    session = db.get(VivaSession, session_id)
    if (
        not session
        or session.status != "completed"
        or index < 0
        or index >= len(session.data["snapshots"])
    ):
        return None
    data = session.data
    turns = [t for t in data["turns"] if t["concept_index"] == index]
    if not turns:
        return None
    selected = turns[:1] if condition == "A" else turns
    return {
        "answer_state": selected[-1]["assessment"]["state"],
        "gap_outcome": differentiate(turns, condition)[0],
    }


def classification_metrics(truth, predicted, labels):
    if not truth:
        return None, None, None
    from sklearn.metrics import accuracy_score, cohen_kappa_score, f1_score

    accuracy = float(accuracy_score(truth, predicted))
    f1 = float(f1_score(truth, predicted, labels=labels, average="macro", zero_division=0))
    # Kappa is undefined for one pair or a single shared label: return null, never NaN.
    kappa = None
    if len(truth) >= 2 and len(set(truth + predicted)) > 1:
        value = float(cohen_kappa_score(truth, predicted, labels=labels))
        if math.isfinite(value):
            kappa = value
    return accuracy, f1, kappa


def metrics(db):
    ratings = list(db.scalars(select(HumanRating)))
    conditions = []
    for condition in ("A", "B", "C"):
        pairs = [
            (r, prediction(db, r.case_id, condition)) for r in ratings if r.condition == condition
        ]
        pairs = [(r, p) for r, p in pairs if p is not None]
        result = {"condition": condition, "n": len(pairs)}
        for prefix, field, labels in (
            ("answer", "answer_state", STATES),
            ("gap", "gap_outcome", GAPS),
        ):
            a, f, k = classification_metrics(
                [r.data[field] for r, _ in pairs], [p[field] for _, p in pairs], labels
            )
            result.update({f"{prefix}_accuracy": a, f"{prefix}_macro_f1": f, f"{prefix}_kappa": k})
        conditions.append(result)
    grouped = {}
    for rating in ratings:
        grouped.setdefault((rating.case_id, rating.condition), []).append(rating)
    by_rater_pair = {}
    disagreement = 0
    for group in grouped.values():
        for left, right in combinations(sorted(group, key=lambda r: r.rater_id), 2):
            by_rater_pair.setdefault((left.rater_id, right.rater_id), []).append((left, right))
            disagreement += left.data["gap_outcome"] != right.data["gap_outcome"]
    all_pairs = [pair for pairs in by_rater_pair.values() for pair in pairs]
    # Pooled pairwise kappa is labeled explicitly; no invalid Cohen calculation over 3+ rater labels.
    kappas = []
    for pairs in by_rater_pair.values():
        _, _, k = classification_metrics(
            [a.data["gap_outcome"] for a, _ in pairs],
            [b.data["gap_outcome"] for _, b in pairs],
            GAPS,
        )
        if k is not None:
            kappas.append(k)

    def average_rating(field):
        values = [r.data[field] for r in ratings if r.data.get(field) is not None]
        return round(mean(values), 4) if values else None

    return {
        "conditions": conditions,
        "inter_rater": {
            "n": len(all_pairs),
            "kappa": round(mean(kappas), 4) if kappas else None,
            "disagreements": disagreement,
            "rater_pairs": len(by_rater_pair),
        },
        "follow_up_appropriateness": average_rating("follow_up_appropriateness"),
        "feedback_usefulness": average_rating("feedback_usefulness"),
        "notes": [
            "No ratings means no measured accuracy; null means unavailable or mathematically undefined.",
            "Macro F1 uses all six answer classes and all three gap classes, with absent classes scored zero.",
            "Metrics compare each independent rater label with its evidence-condition prediction; repeated ratings of one case are not independent samples.",
            "A uses initial answers; B uses answers plus follow-ups; C additionally uses hesitation. C01 mastery is shown to raters as independent reference evidence and never enters system decisions.",
            "Inter-rater kappa is the unweighted mean of defined pairwise Cohen gap-label kappas, pooled over matched case-condition units. Disagreements are also reported.",
            "Retrospective ablations share recorded questions. Counterbalance rater assignment externally to avoid carryover.",
            "Feedback usefulness is an optional separately collected post-rating measure; system feedback is deliberately absent from the blinded case view.",
        ],
    }
