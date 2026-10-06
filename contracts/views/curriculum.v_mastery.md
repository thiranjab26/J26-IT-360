# curriculum.v_mastery

**Producer:** C1 (curriculum-service) · **Consumer:** C3 (tutor-service) · **Status:** proposed v1 (additive change to draft v0)

Current mastery estimate per learner and concept. C3 consumes this to gate unlocks; C3 never computes mastery itself. C1 is the only writer of mastery.

| Column | Type | Notes |
|---|---|---|
| `user_id` | uuid | References `core.users` |
| `concept_id` | text | References `core.concepts` |
| `mastery_score` | numeric | 0.0 to 1.0. BKT probability that the concept is learned |
| `is_mastered` | boolean | `mastery_score >= 0.70`, the platform-wide mastery threshold. **New in v1** |
| `evidence_count` | integer | Graded responses behind the estimate. 0.7 after 1 answer is weaker evidence than 0.7 after 20. **New in v1** |
| `needs_reassessment` | boolean | Set when a C4 viva contradicted the score. Consumers should not unlock on this concept until it clears. The score itself is unchanged (FR-12). **New in v1** |
| `updated_at` | timestamptz | Last recomputation |

Grain: one row per user and concept the learner has evidence for.

**A missing row means no evidence yet**, which consumers treat as not mastered.

**Threshold:** 0.70 is agreed across the platform. C1's roadmap and C3's unlock rules must use `is_mastered` rather than re-deriving it, so the two never disagree.
