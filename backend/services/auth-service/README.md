# auth-service

AdaptLearn authentication. Shared service, owned by the project leader.

Owns identity: it is the only service that writes `core.users`, hashes passwords
or signs tokens. Every other service reads the caller from the `X-User-Id` and
`X-User-Role` headers the gateway forwards, and never sees the signing secret.

## Routes

| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | Liveness. Returns `{"status": "ok"}` |
| POST | `/api/v1/auth/register/student` | Register a student, returns a token |
| POST | `/api/v1/auth/register/lecturer` | Register a lecturer, returns a token |
| POST | `/api/v1/auth/login` | Email and password for a token |
| GET | `/api/v1/auth/me` | The signed-in user |

Students and lecturers have separate registration endpoints. The role comes from
the endpoint that was called, never from a field in the request body, so a client
cannot register itself as a lecturer through the student form.

Errors use the shared shape: `{"error": {"code": "...", "message": "...", "details": {}}}`.
Registration conflicts return `409` with code `email_taken` or `student_number_taken`
and a `details.field` the frontend attaches to the right input.

## Schema

This service's schema is the shared `core` schema, so it has **no Alembic setup
of its own**. `core` is migrated from `database/core`, by the leader:

```bash
cd database/core && alembic upgrade head
```

Do not add migrations here. Two histories over one schema is how you lose a
database. `app/db/tables.py` maps onto tables those migrations create.

## Run it

```bash
uv sync
cp .env.example .env          # paste your Neon pooled connection string
uv run uvicorn app.main:app --reload --port 8001
```

Then, through the gateway once it is running:

```bash
curl http://localhost:8080/api/v1/auth/health
```

## Environment

Every variable is listed in `.env.example`. `AUTH_JWT_SECRET` must be
byte-identical to the gateway's `JWT_SECRET`, since this service signs the token
the gateway verifies.

## Tests

```bash
uv run pytest            # unit tests, no database needed
uv run ruff check . && uv run ruff format .
```
