# Contracts

The agreed shape of everything that crosses a component boundary. If it is not described here, it is not a contract and nobody may depend on it.

## What lives here

| Folder | Contents |
|---|---|
| `views/` | One Markdown file per published `v_*` view: columns, types, grain, consumer |
| `schemas/` | JSON Schema for pushed API payloads. Currently only the C2 to C3 load signal |

One file per view, deliberately, so two owners editing different views do not collide.

**REST API shapes are not kept here.** FastAPI generates OpenAPI from the code, so a hand-written spec would only drift. The frontend generates its types from a running service:

```bash
pnpm gen:types:tutor    # reads http://localhost:8301/openapi.json
```

Run your own service, generate, commit the result into `frontend/src/shared/api/generated/`. That folder is generated; never hand-edit it.

## Contracts v0

| Contract | Producer | Consumer | Mechanism |
|---|---|---|---|
| `content.v_unit_manifest` | C3 | C1 | view |
| `content.v_verified_passages` | C3 | C4 | view |
| `tutor.v_attempt_outcomes` | C3 | C1 | view |
| `curriculum.v_mastery` | C1 | C3 | view |
| `curriculum.v_next_topic` | C1 | C3 | view |
| `curriculum.v_topic_mastery` | C1 | C3 | view (proposed v1) |
| `curriculum.v_verification_candidates` | C1 | C4 | view (proposed v1) |
| `tutor.v_session_exits` | C3 | C1 | view (proposed v1) |
| `load.v_current_load` | C2 | C1 | view (proposed v1) |
| `viva.v_review_flags` | C4 | C1 | view (proposed v1) |
| `load-signal` | C2 | C3 | HTTP push to `tutor-service POST /internal/load` |

The load signal is the only API contract between components because it is real time and changes within a session. Everything else is read from the shared database.

## Changing a contract

1. Open a PR that changes the file here **first**, before any implementation.
2. Tag every consumer listed for that contract. CODEOWNERS requires their approval.
3. Additive changes (a new nullable column) are cheap. Renames and removals need the consumer's change to land first.

The PR history is the changelog. A view is the stable surface: you may restructure your own tables freely as long as the view keeps its shape.
