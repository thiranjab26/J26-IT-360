# Shared database

One Neon Postgres database, one schema per owner. Owned by the project leader.

## Schemas

| Schema | Owner | Written by | Contains |
|---|---|---|---|
| `core` | leader | `database/core/migrations` only | users, roles, modules, topics, concepts |
| `curriculum` | C1 | curriculum-service | concept mastery, next-topic decisions |
| `load` | C2 | load-service | cognitive load observations |
| `content` | C3 | tutor-service | units, chunks, concept tags, passages |
| `tutor` | C3 | tutor-service | sessions, checkpoints, attempts, XP, gate events |
| `viva` | C4 | viva-service | viva sessions, question bank, evaluations |

## Rules

1. A service writes **only** to its own schema, using the role `svc_<service>`.
2. A service reads another owner's data **only** through that owner's published `v_*` views. `core` tables are the exception and may be read directly.
3. Each service migrates its own schema with its own Alembic setup and its own `version_table_schema`. Never migrate someone else's schema.
4. `core` migrations and the concept seed data change only through a PR approved by all four owners.
5. Every member develops on their **own Neon branch**. `main` branch of the database is the shared integration copy.

## Files

| File | Purpose |
|---|---|
| `schemas.sql` | Creates `core`, `content`, `tutor`, `curriculum`, `load`, `viva` |
| `roles.sql` | Creates one role per service, write grants on its own schema, read grants on `core` |
| `core/alembic.ini`, `core/migrations/` | Migrations for the `core` schema only |
| `seed/concepts_programming.csv` | Concept list for Programming Fundamentals in Java (`prog.*`), generated from the frontmatter of `tutor-service/content/prog/` |
| `seed/concepts_dsa.csv` | Agreed concept list for the DSA module (`dsa.*`) |

## Concept IDs

Concept IDs are the join key between C3's content and C1's graph, so they are defined once in `core.concepts` and seeded from the CSVs above.

- C1 owns the prerequisite **relationships** between concepts (in Neo4j).
- C3 owns which **units and practicals** cover which concepts (in `content`).
- Nobody invents a concept ID locally. New concepts are added by PR to the seed files, approved by C1 and C3.

The programming CSV is derived from the course content, so the content is the source of truth: change a concept in its markdown frontmatter first, then regenerate the CSV. `core.modules.status` is `available` once a module's content is authored and `coming_soon` until then; the DSA concept list is seeded early because C1's graph needs the IDs.

Seed columns: `concept_id`, `name`, `module_id`, `topic`, `description`, `prerequisites_same_module`, `prerequisites_cross_module`. Prerequisite lists are `;` separated.

## Setup order (leader, once per database branch)

```bash
psql "$DATABASE_URL" -f database/schemas.sql
psql "$DATABASE_URL" -f database/roles.sql
cd database/core && alembic upgrade head
# then load the concept seed CSVs
```
