# curriculum.v_topic_mastery

**Producer:** C1 (curriculum-service) · **Consumer:** C3 (tutor-service) · **Status:** proposed v1

Mastery rolled up to topic level, for topic unlocks and messages such as "Requires 70% mastery in Recursion". Published by C1 so that C3 never aggregates concept mastery itself.

| Column | Type | Notes |
|---|---|---|
| `user_id` | uuid | References `core.users` |
| `topic_id` | text | References `core.topics` |
| `mastery_score` | numeric | 0.0 to 1.0. **Minimum** over the topic's concepts: a topic is only as mastered as its weakest concept |
| `is_mastered` | boolean | `mastery_score >= 0.70` and no concept in the topic `needs_reassessment` |
| `concepts_total` | integer | Concepts in the topic |
| `concepts_mastered` | integer | Concepts with `is_mastered` |
| `updated_at` | timestamptz | Latest `updated_at` of the topic's concepts |

Grain: one row per user and topic. A concept with no evidence counts as 0.0, so a topic with an unattempted concept is not mastered.
