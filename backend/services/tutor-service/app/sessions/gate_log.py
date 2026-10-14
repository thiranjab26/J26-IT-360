"""Record what the faithfulness gate decided, one row per claim per generated text."""

from __future__ import annotations

import uuid
from collections.abc import Sequence

from app.sessions.repository import GateEvent, SessionRepository
from app.sessions.writer import GateAudit


def record_audits(
    repo: SessionRepository, audits: Sequence[GateAudit], passage_id: str
) -> str | None:
    """Write every verdict, including those of texts that were then thrown away (the rate
    at which the gate blocks is itself a result). Returns the output_id of the LAST text,
    which is the one that was shown (or the last one rejected)."""
    output_id: str | None = None
    for audit in audits:
        output_id = str(uuid.uuid4())
        per_claim_ms = audit.result.verify_ms // max(1, len(audit.result.verdicts))
        repo.add_gate_events(
            [
                GateEvent(
                    output_id=output_id,
                    attempt=audit.attempt,
                    granularity=audit.result.granularity,
                    passage_id=passage_id,
                    claim_text=v.text,
                    nli_model=v.model,
                    nli_label=v.label,
                    nli_score=v.p_entailment,
                    decision="pass" if v.supported else "block",
                    latency_ms=per_claim_ms,
                )
                for v in audit.result.verdicts
            ]
        )
    return output_id
