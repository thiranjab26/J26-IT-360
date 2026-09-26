# curriculum.v_mastery

**Producer:** C1 (curriculum-service) · **Consumer:** C3 (tutor-service) · **Status:** draft v0

Current mastery estimate per learner and concept. C3 consumes this to gate unlocks; C3 never computes mastery itself.

| Column | Type | Notes |
|---|---|---|
| `user_id` | uuid | References `core.users` |
| `concept_id` | text | References `core.concepts` |
| `mastery_score` | numeric | 0.0 to 1.0 |
| `updated_at` | timestamptz | Last recomputation |

Grain: one row per user and concept. Stubbed on the C3 side until phase P7.
