# viva.v_review_flags

**Producer:** C4 (viva-service) · **Consumer:** C1 (curriculum-service) · **Status:** proposed v1

Concepts where a spoken viva contradicted the recorded mastery. C1 marks the concept for re-assessment (FR-11) and never changes the mastery value on the flag alone (FR-12).

| Column | Type | Notes |
|---|---|---|
| `flag_id` | uuid | Stable identifier, so C1 processes each flag once |
| `user_id` | uuid | References `core.users` |
| `concept_id` | text | References `core.concepts` |
| `verdict` | text | `not_demonstrated` or `partially_demonstrated` |
| `mastery_at_viva` | numeric | The C1 mastery value C4 saw when it ran the viva |
| `flagged_at` | timestamptz | When the viva finished |

Grain: one row per flag. Append only.
