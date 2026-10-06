# curriculum.v_next_topic

**Producer:** C1 (curriculum-service) · **Consumer:** C3 (tutor-service) · **Status:** proposed v1 (additive change to draft v0)

C1's recommendation for what the learner should study next. C3 teaches this concept next and must not apply its own ordering on top of it, because the C1 evaluation compares an adaptive order against the fixed syllabus order and only the order may differ between the groups.

| Column | Type | Notes |
|---|---|---|
| `user_id` | uuid | References `core.users` |
| `next_topic_id` | text | References `core.topics`. Topic of `next_concept_id` |
| `next_concept_id` | text | References `core.concepts`. The concept to teach next. **New in v1** |
| `target_concept_id` | text | Nullable. The concept the learner is working towards, when `next_concept_id` is a prerequisite being reinforced first. **New in v1** |
| `weak_prerequisite_id` | text | Nullable. Concept to reinforce first |
| `readiness` | numeric | 0.0 to 1.0. Model readiness for `next_concept_id`. **New in v1** |
| `explanation` | text | One plain sentence naming the reason, shown to the learner as is. **New in v1** |
| `reason` | text | `adaptive`, `revision_high_load`, `reassessment` or `fixed_order`. **New in v1** |
| `model_version` | text | For example `gat-v1` or `rules-v1`. **New in v1** |
| `updated_at` | timestamptz | When the recommendation was made. **New in v1** |

Grain: one row per user.

**Study groups.** For a learner in the comparison group, C1 returns the fixed syllabus order with `reason = 'fixed_order'` and `explanation` null. Consumers do not need to know the group; they always follow this view.
