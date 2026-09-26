# ADR 0002: One shared Postgres database with one schema per owner, views as contracts

- **Status:** Accepted
- **Date:** 2026-09-26
- **Deciders:** all four component owners

## Context

The components genuinely share data: C3's content defines what C1's graph is built from, C1's mastery estimates drive C3's unlocks, C3's verified passages ground C4's viva questions. A database per service would force service-to-service APIs for what is really reference and history data, and would mean four cloud databases on free tiers.

A single database with everyone writing everywhere is the other failure mode: any member can break another member's data and nobody can refactor their own tables safely.

## Decision

One Neon Postgres database. One schema per owner (`core`, `curriculum`, `load`, `content`, `tutor`, `viva`) and one Postgres role per service with write grants only on its own schema and read grants on `core`.

Cross-component reads go through published `v_*` views. **The view is the contract**, documented in `contracts/views/`. Raw tables of another owner are never read. `core` tables are the single exception and may be read directly, because they are shared reference data that nobody but the leader writes.

Each service runs its own Alembic setup with `version_table_schema` pointing at its own schema. Every member develops on their own Neon branch.

Only real-time data uses an HTTP API between components: the C2 load signal pushed to C3. Everything else is read from the database.

## Consequences

- Each owner can restructure their own tables freely as long as their views keep shape.
- No service-to-service call is needed for any of the reference or history flows, which removes most of the integration risk from the schedule.
- Schema changes to `core` and the concept seed data need all-owner approval, and concept IDs must never be invented locally.
- Consumers develop against stubs (`INTEGRATION_MODE=stub`) until phase P7, so nobody is blocked by another member's progress.
