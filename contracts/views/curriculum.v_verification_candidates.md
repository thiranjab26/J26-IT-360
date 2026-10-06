# curriculum.v_verification_candidates

**Producer:** C1 (curriculum-service) · **Consumer:** C4 (viva-service) · **Status:** proposed v1

Concepts C1 nominates for spoken verification: mastered recently and not yet verified. If this view is unavailable, learners can still start a viva manually.

| Column | Type | Notes |
|---|---|---|
| `user_id` | uuid | References `core.users` |
| `concept_id` | text | References `core.concepts` |
| `mastery_score` | numeric | Current C1 estimate |
| `nominated_at` | timestamptz | When the concept crossed the mastery threshold |

Grain: one row per user and concept.
