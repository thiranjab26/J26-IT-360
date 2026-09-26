# frontend

One React app, split by feature. Each member owns one folder under `src/features/`.

## Run it

```bash
pnpm install          # from the repository root, once
pnpm --filter frontend dev
```

Opens on http://localhost:5173. The app calls same-origin `/api/*` paths, which
`vite.config.ts` proxies to the gateway on 8080. The browser never addresses a
service directly.

You also need the gateway and at least auth-service and curriculum-service
running for the current screens. See the root README.

## What exists today

| Route | Feature | Screen |
|---|---|---|
| `/login` | `features/auth` | Sign in |
| `/register` | `features/auth` | Register, student or lecturer |
| `/dashboard` | `features/curriculum` | The student's modules |
| `/modules/:moduleId` | `features/curriculum` | Concepts of one module, grouped by topic |

Everything below `RequireAuth` needs a valid token; `/login` and `/register` are
the only public screens.

## Structure

```
src/
├── app/            router, providers, layouts, RequireAuth  (shared, PR review)
├── shared/         api client, auth session, UI primitives  (shared, PR review)
└── features/
    ├── auth/           leader
    ├── curriculum/     C1
    ├── cognitive-load/ C2
    ├── tutor/          C3
    └── viva/           C4
```

A feature exports its routes through `index.ts` and nothing else. Other features
import only from that file, never from a feature's internals. Adding a feature is
one line in `app/router.tsx`.

## Design tokens

`src/index.css` holds the whole design system as a Tailwind v4 `@theme` block,
taken from the VeriTutor UI mockups: three oklch hues (265 neutral and brand,
150 verified, 70 caution), Geist for UI text, JetBrains Mono for identifiers and
metadata. Use the token names (`bg-brand`, `text-ink-muted`, `border-line`)
rather than raw colours, so every screen stays consistent.

## Generating API types

Types for a service are generated from that service's live OpenAPI document, so
run the service first:

```bash
pnpm gen:types:curriculum      # needs curriculum-service on 8101
```

Output lands in `src/shared/api/generated/` and is never hand-edited.
