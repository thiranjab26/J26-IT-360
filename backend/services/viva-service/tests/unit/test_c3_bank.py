"""The C3 catalogue bank: valid, grounded in its material, and true to the C3 seed."""

import csv
from pathlib import Path

import pytest

from app.db.repositories.materials import validate_grounding
from app.domain import c3_bank

SEED = Path(__file__).resolve().parents[5] / "database" / "seed"


def test_every_question_is_valid_and_grounded_in_its_material():
    bank = c3_bank.build()
    questions = [q for course in bank for q in course["questions"]]
    assert len(bank) == 10 and len(questions) == 24
    assert len({q["id"] for q in questions}) == 24
    for course in bank:
        assert 1 <= len(course["questions"]) <= 6  # a session asks at most six concepts
        context = {"c03": {"chunks": course["material"]["chunks"]}}
        for question in course["questions"]:
            validate_grounding(question, context, required=True)  # what re-approval checks


def test_names_descriptions_and_grouping_follow_the_c3_seed():
    files = sorted(SEED.glob("concepts_*.csv"))
    if not files:
        pytest.skip("The C3 seed CSVs are not in this checkout.")
    seed = {r["concept_id"]: r for f in files for r in csv.DictReader(f.open(encoding="utf-8"))}
    assert set(c3_bank.CONCEPTS) == set(seed)
    for concept_id, c in c3_bank.CONCEPTS.items():
        assert (c["name"], c["description"]) == (
            seed[concept_id]["name"],
            seed[concept_id]["description"],
        )
    module = {"dsa": "IT2070", "prog": "IT1010"}
    for _, code, _, ids in c3_bank.COURSES:
        assert len({seed[i]["topic"] for i in ids}) == 1  # one C3 topic per course
        assert {module[seed[i]["module_id"]] for i in ids} == {code}
