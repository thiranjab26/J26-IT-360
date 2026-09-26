# ADR 0003: No Docker for development

- **Status:** Accepted
- **Date:** 2026-09-26
- **Deciders:** all four component owners

## Context

The team develops on student laptops of varying capability, including machines where Docker Desktop is a real memory cost. Three of the four components run ML models locally, and one needs GPU or at least unconstrained CPU access. Containerising development would add a layer to debug on top of already heavy dependencies, in a project where the deadline risk is research work, not deployment.

## Decision

Every service runs natively. Python services use `uv` with a pinned 3.11 and per-service dependencies; the gateway and frontend use pnpm workspaces. The vector store is ChromaDB in embedded mode (`PersistentClient`) so there is no server to install. Nobody runs the whole platform: each member runs the frontend, the gateway and their own service, and the gateway returns a clean 503 for services that are not up.

The single exception is **Piston**, C3's sandbox for executing student code, from phase P4. Isolation is the entire point of that component, so it stays containerised and is confined to `infra/piston/`.

Docker can be introduced for deployment later without changing application code.

## Consequences

- Faster first-run setup and no container debugging for three of four components.
- Local environments differ slightly between members, so CI is the arbiter of correctness.
- Developers must install Python 3.11, Node 20, uv and pnpm themselves; the prerequisites table in the README is the contract for that.
- C3 carries a single Docker dependency from P4 onward, isolated behind `TUTOR_PISTON_URL`.
