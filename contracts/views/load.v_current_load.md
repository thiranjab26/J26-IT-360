# load.v_current_load

**Producer:** C2 (load-service) · **Consumer:** C1 (curriculum-service) · **Status:** proposed v1

The latest categorical cognitive load state per learner. C1 uses it to prefer revision over new material when load is high (FR-10). C3 keeps receiving the real-time push (`load-signal`); this view is the same information for consumers that only need the latest value.

| Column | Type | Notes |
|---|---|---|
| `user_id` | uuid | References `core.users` |
| `load_state` | text | `low`, `medium` or `high`. Categorical only, no biometric data |
| `observed_at` | timestamptz | When C2 last classified the state |

Grain: one row per user. A row older than 10 minutes is treated by C1 as unknown, and C1 then ranks on mastery and readiness alone.
