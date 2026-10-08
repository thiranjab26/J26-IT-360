"""Where C3 practice attempts are read from: C1's stand-in table or C3's published view."""

from __future__ import annotations

from typing import Literal

# Same columns as contracts/views/tutor.v_attempt_outcomes.md.
STUB_RELATION = "curriculum.stub_attempt_outcomes"
LIVE_RELATION = "tutor.v_attempt_outcomes"


def attempts_relation(mode: Literal["stub", "live"]) -> str:
    return LIVE_RELATION if mode == "live" else STUB_RELATION
