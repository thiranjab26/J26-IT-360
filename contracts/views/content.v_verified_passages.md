# content.v_verified_passages

**Producer:** C3 (tutor-service) · **Consumer:** C4 (viva-service) · **Status:** draft v0

Retrieval passages that passed C3's faithfulness gate, so C4 can ground its viva question bank in verified text.

| Column | Type | Notes |
|---|---|---|
| `passage_id` | text | Grain of the view |
| `concept_id` | text | References `core.concepts` |
| `text` | text | The passage content |
| `source_unit_id` | text | The unit the passage was chunked from |
| `verified_at` | timestamptz | When the passage last passed verification |

Grain: one row per verified passage.
