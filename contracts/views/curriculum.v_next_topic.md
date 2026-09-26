# curriculum.v_next_topic

**Producer:** C1 (curriculum-service) · **Consumer:** C3 (tutor-service) · **Status:** draft v0

C1's recommendation for what the learner should study next.

| Column | Type | Notes |
|---|---|---|
| `user_id` | uuid | References `core.users` |
| `next_topic_id` | text | References `core.topics` |
| `weak_prerequisite_id` | text | Nullable. Concept to reinforce first |

Grain: one row per user. Stubbed on the C3 side until phase P7.
