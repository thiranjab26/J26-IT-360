# ADR 0004: C2 load sensor as a workspace package

- **Status:** Proposed
- **Date:** 2026-10-06
- **Deciders:** C2 owner; leader approval needed for `pnpm-workspace.yaml` and `CODEOWNERS`

## Context

C2 (Cognitive Load Detection) is not a server-side model. The approved proposal requires all video processing to happen in the browser (FR1, FR7, NFR2): webcam, MediaPipe FaceMesh landmarks, feature extraction and the 1D-CNN + GRU classifier all run client-side, and only a small categorical load-state event leaves the module.

That code has requirements the React app in `frontend/` does not share:

- A framework-agnostic core, so C1, C3 and C4 can embed it without depending on React.
- Its own build-time privacy guards (lint rules that ban network APIs in the core), its own Content Security Policy and offline service worker, and Playwright tests that run with a fake camera and assert zero network requests.
- A standalone demo and debug overlay used for the pilot study and for benchmarking, separate from the product UI.

Putting it inside `frontend/src/features/cognitive-load/` would apply those build, CSP and service-worker settings to the whole frontend. Putting it inside `backend/services/load-service/` would place browser code in a Python service directory outside the pnpm workspace.

## Decision

The in-browser sensor is a pnpm workspace package at `packages/load-sensor/` (`@adaptlearn/load-sensor`), owned by C2.

- `pnpm-workspace.yaml` gains `packages/*`.
- `CODEOWNERS` gains `/packages/load-sensor/ @owner-c2`.
- `frontend/src/features/cognitive-load/` imports the package's public API (`createLoadSensor`) and owns the product UI around it (consent, toggle).
- Offline training code lives in `research/c2-load/`, consistent with the rule that nothing in `research/` is imported by a running service.
- `backend/services/load-service/` stays reserved for any server-side C2 work (for example persisting load events to the `load` schema); it holds no video or landmark code.

## Consequences

- The privacy boundary is one directory with its own lint rules and tests, which keeps the NFR2 evidence easy to audit.
- A new top-level directory, `packages/`, is added to the seven listed in `docs/architecture.md` §3. That section should be updated in a follow-up PR approved by all owners.
- The package has its own CI workflow, path-filtered like the per-service workflows.
- Teammates consume a typed library rather than an HTTP API for in-page use; the `contracts/schemas/load-signal.schema.json` push to C3 remains the server-side path.
