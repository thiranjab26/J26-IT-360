"""AI marking since 9 Oct 2026: partial credit, speech-tolerant rules, quoted misconceptions."""

from app.config import settings
from app.integrations import llm as providers

QUESTION = {
    "concept": "Variables",
    "question": "What is a variable?",
    "reference_answer": "A variable is a named storage location that holds a value.",
    "rubric_points": [
        {
            "id": "name",
            "point": "A variable is a named storage location.",
            "probe": "What is a variable?",
        },
        {
            "id": "value",
            "point": "It holds a value that can change.",
            "probe": "What does it hold?",
        },
        {"id": "type", "point": "Each value has a data type.", "probe": "What is a type?"},
    ],
    "misconceptions": [{"description": "A variable is a data type."}],
}


def fake(monkeypatch, raw):
    seen = {}

    def call_llm(provider, instruction, payload, schema, max_tokens=None):
        seen.update(instruction=instruction, schema=schema)
        return {**raw, "rubric_hits": [dict(h) for h in raw["rubric_hits"]]}

    monkeypatch.setattr(settings(), "assessment_provider", "openai")
    monkeypatch.setattr(providers, "call_llm", call_llm)
    return seen


def hits(name, value, type_):
    return [
        {"id": "name", "point": "x", "level": name},
        {"id": "value", "point": "x", "level": value},
        {"id": "type", "point": "x", "level": type_},
    ]


def test_everyday_wording_earns_half_and_full_needs_the_term(monkeypatch):
    seen = fake(
        monkeypatch,
        {
            "state": "complete",
            "coverage": 0,
            "rubric_hits": hits("full", "partial", "none"),
            "missing_points": [],
            "misconceptions": [],
            "reason": "Box analogy.",
            "provider": "x",
        },
    )
    result = providers.assess(
        QUESTION, "What is a variable?", "It is like a box with a label that keeps data", []
    )
    assert result["coverage"] == 50.0  # (1 + 0.5 + 0) / 3
    assert [h["covered"] for h in result["rubric_hits"]] == [True, False, False]
    assert result["state"] == "partial"  # "complete" needs every point at full
    assert result["missing_points"][0].endswith("(idea shown; name it precisely)")
    assert "second-language" in seen["instruction"] and "decibel" in seen["instruction"]
    assert seen["schema"]["$defs"]["Hit"]["required"] == ["id", "point", "level"]


def test_a_misconception_counts_only_with_the_students_own_words(monkeypatch):
    raw = {
        "state": "misconception_bearing",
        "coverage": 0,
        "rubric_hits": hits("full", "none", "none"),
        "missing_points": [],
        "reason": "Confuses terms.",
        "provider": "x",
        "misconceptions": [
            {"description": "A variable is a data type.", "quote": "a variable is a data type"}
        ],
    }
    fake(monkeypatch, raw)
    said = "Shape is the variable and square is the value, so string is the data type"
    result = providers.assess(QUESTION, "q", said, [])
    assert result["misconceptions"] == [] and result["state"] == "partial"
    assert "not counted" in result["reason"]
    fake(monkeypatch, raw)
    result = providers.assess(QUESTION, "q", "Well, a variable is a data type I think", [])
    assert result["misconceptions"] == ["A variable is a data type."]
    assert result["state"] == "misconception_bearing"


def test_points_keep_the_best_level_from_earlier_answers(monkeypatch):
    prior = [
        {
            "question": "q",
            "transcript": "t",
            "assessment": {
                "misconceptions": [],
                "rubric_hits": [
                    {"id": "name", "point": "x", "covered": True, "level": "full"},
                    {"id": "value", "point": "x", "covered": False, "level": "partial"},
                    {"id": "type", "point": "x", "covered": False},  # an older hit without a level
                ],
            },
        }
    ]
    fake(
        monkeypatch,
        {
            "state": "partial",
            "coverage": 0,
            "rubric_hits": hits("none", "none", "full"),
            "missing_points": [],
            "misconceptions": [],
            "reason": "r",
            "provider": "x",
        },
    )
    result = providers.assess(QUESTION, "q", "count = 5 is an integer type", prior)
    assert [h["level"] for h in result["rubric_hits"]] == ["full", "partial", "full"]
    assert result["coverage"] == round(100 * 2.5 / 3, 1)
