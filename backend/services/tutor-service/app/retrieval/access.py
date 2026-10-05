"""Which kinds of course content each use of the tutor may retrieve.

This is the one place the rule lives, because it protects the research as much as the
student. Practice questions have authored solutions and rubrics in the same files as
the theory. If the tutor, the help chatbot or the question generator could retrieve
them, a student asking "difference between while and do-while" could be handed the
answer to the practice question they are working on, and a generated question could
be built from its own answer key. The faithfulness gate would then verify the
tutor's explanation against evidence it should never have had.

The mode names are the same three used for the gate log (`tutor.gate_events.
generation_mode`), so retrieval and verification speak one vocabulary.

    tutoring    teaching, the help chatbot and hints. Explanatory content only.
    practical   generating questions and practicals. Explanatory content, plus the
                authored exercises as examples of style. Never solutions or rubrics.
    grading     judging an answer. Reaches the model answer and the rubric, but only
                for the concept being assessed (see Retriever.search) or for one named
                question (Retriever.question_materials), never by open search.

`objectives`, `prerequisites` and `overview` are for planning a session and are not
searched in any mode. `further_practice` is not indexed at all.
"""

from __future__ import annotations

from enum import StrEnum


class RetrievalMode(StrEnum):
    TUTORING = "tutoring"
    PRACTICAL = "practical"
    GRADING = "grading"


# What similarity search may return, per mode.
SEARCHABLE_SECTIONS: dict[RetrievalMode, tuple[str, ...]] = {
    RetrievalMode.TUTORING: ("theory", "example", "misconception", "facts"),
    RetrievalMode.PRACTICAL: ("theory", "facts", "misconception", "exercise"),
    RetrievalMode.GRADING: ("solution", "rubric", "facts", "theory"),
}

# Sections that carry answers. No mode other than grading may ever see these.
ANSWER_SECTIONS = ("solution", "rubric")

# Modes that must stay scoped to a concept, because their evidence is answer keys:
# searching the whole module for "the rubric about loops" would pull in other
# questions' answers.
CONCEPT_SCOPED_MODES = frozenset({RetrievalMode.GRADING})


def searchable_sections(mode: RetrievalMode) -> tuple[str, ...]:
    return SEARCHABLE_SECTIONS[mode]
