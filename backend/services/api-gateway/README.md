# api-gateway

The only entry point the browser talks to. Shared service, owned by the project leader.

## What it does

1. **Verifies the JWT.** The only component that does. It then sets `X-User-Id`
   and `X-User-Role` from the token's `sub` and `role` claims, which every
   service trusts (see each service's `core/deps.py`).
2. **Strips client-supplied identity headers** before reading the token, so a
   caller cannot forge `X-User-Id`.
3. **Propagates `X-Request-Id`**, adopting the caller's or minting one, so a
   single request can be followed across the gateway and the services it hits.
4. **Proxies `/api/v1/<service>/*`** to that service, path unchanged.
5. **Answers 503 with a useful message** when a service is not running, naming
   the service and the command to start it. Nobody runs the whole platform
   locally, so this is the normal case rather than an incident.
6. **Blocks `/internal/*`** with a 404. Internal routes exist for
   service-to-service calls only, such as C2 pushing a load signal to C3.

## Public routes

Everything needs a token except:

- `POST /api/v1/auth/login`
- `POST /api/v1/auth/register/student`
- `POST /api/v1/auth/register/lecturer`
- `GET /health` and any service's `/api/v1/<service>/health`

## Run it

```bash
pnpm install                        # from the repository root, once
cp .env.example .env
pnpm --filter api-gateway dev       # http://localhost:8080
```

`JWT_SECRET` must be byte-identical to auth-service's `AUTH_JWT_SECRET`: auth
signs the token, the gateway verifies it. If they differ, every request fails
with `invalid_token`.

## Routing table

| Gateway path | Upstream | Owner |
|---|---|---|
| `/api/v1/auth/*` | `AUTH_SERVICE_URL` (8001) | leader |
| `/api/v1/curriculum/*` | `CURRICULUM_SERVICE_URL` (8101) | C1 |
| `/api/v1/load/*` | `LOAD_SERVICE_URL` (8201) | C2 |
| `/api/v1/tutor/*` | `TUTOR_SERVICE_URL` (8301) | C3 |
| `/api/v1/viva/*` | `VIVA_SERVICE_URL` (8401) | C4 |

Adding a service is one entry in `src/config.ts`.
