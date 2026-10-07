# @adaptlearn/load-sensor (C2)

Privacy-first, in-browser cognitive load sensor for AdaptLearn. Webcam frames are processed entirely on the device; only a small load-state event leaves the module. Owner: C2. Why this is a workspace package: [ADR 0004](../../docs/adr/0004-c2-load-sensor-package.md).

Design and plan: [ARCHITECTURE](../../docs/c2/ARCHITECTURE.md) · [TODO](../../docs/c2/TODO.md) · [SKILLS](../../docs/c2/SKILLS.md)

## Run it

From the repository root, once:

```bash
pnpm install
```

Then, once per clone, download the face mesh models and copy the TF.js WASM binaries into `public/` (checked against the committed lock file `public/models/MANIFEST.json`):

```bash
pnpm fetch-models            # add --verify to check without network, --update-lock to upgrade on purpose
```

Then, inside `packages/load-sensor/`:

```bash
pnpm dev          # demo / debug page on http://localhost:5174 (camera needs localhost or https)
pnpm build        # production build of the demo page
pnpm preview      # serve the production build on http://localhost:4174
pnpm typecheck    # tsc for browser code and for node-side code
pnpm lint         # eslint + prettier --check
pnpm test         # vitest unit tests
pnpm test:e2e     # playwright against the production build, fake camera
pnpm check        # typecheck + lint + test: run before calling a change done
pnpm bench        # latency and memory benchmark (TODO A7; exits 1 until then)
```

## Layout

```
src/core/      the library (framework-agnostic; the deliverable)
  camera/ landmarks/ features/ window/ classifier/ events/ recorder/
  index.ts     public API, the only module other components import
src/demo/      debug overlay, consent screen, study runner
public/models/ self-hosted model files (downloaded by fetch-models, not committed)
tests/         unit/ (vitest), e2e/ (playwright), fixtures/ (landmark arrays, never images)
```

Offline training code lives in [`research/c2-load/`](../../research/c2-load/).
