# tutor.v_attempt_outcomes

**Producer:** C3 (tutor-service) · **Consumer:** C1 (curriculum-service) · **Status:** draft v0

Checkpoint and practical outcomes, used by C1 as evidence for its mastery model.

| Column | Type | Notes |
|---|---|---|
| `user_id` | uuid | References `core.users` |
| `concept_id` | text | References `core.concepts` |
| `item_id` | text | Checkpoint or practical identifier |
| `correct` | boolean | Graded outcome |
| `hints_used` | smallint | 0 or more |
| `attempted_at` | timestamptz | Attempt time |

Grain: one row per attempt. Append only.
