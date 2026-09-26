# content.v_unit_manifest

**Producer:** C3 (tutor-service) · **Consumer:** C1 (curriculum-service) · **Status:** draft v0

Every authored content unit and the concepts it covers, so C1 can build graph nodes and prerequisite edges.

| Column | Type | Notes |
|---|---|---|
| `unit_id` | text | Grain of the view. Matches unit frontmatter |
| `module_id` | text | References `core.modules` |
| `topic_id` | text | References `core.topics` |
| `concept_ids` | text[] | All values exist in `core.concepts` |
| `difficulty` | smallint | 1 to 5 |
| `practical_ids` | text[] | May be empty |

Grain: one row per unit. Refreshed whenever C3 re-indexes content.
