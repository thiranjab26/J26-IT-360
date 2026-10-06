# tutor.v_session_exits

**Producer:** C3 (tutor-service) · **Consumer:** C1 (curriculum-service) · **Status:** proposed v1

How each tutoring session ended. C1 reads `struggling` exits (three failures on the same checkpoint, `docs/c3/dsa-module-plan.md`) to route the learner to the weak prerequisite on the next recommendation.

| Column | Type | Notes |
|---|---|---|
| `session_id` | uuid | Stable identifier |
| `user_id` | uuid | References `core.users` |
| `concept_id` | text | References `core.concepts`. The concept being taught |
| `exit_state` | text | `completed`, `mastery_satisfied`, `struggling`, `load_exit`, `student_ended` or `timeout` |
| `ended_at` | timestamptz | Session end |

Grain: one row per session. Append only.
