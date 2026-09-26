# ADR 0001: One monorepo with one service per research component

- **Status:** Accepted
- **Date:** 2026-09-26
- **Deciders:** all four component owners

## Context

Four members each build an independently novel research component that must also demonstrate as one platform. Options were four separate repositories, one repository with one shared application, or one repository with one service per component.

Separate repositories make the integrated demo expensive: four deployments, four auth setups, no shared types, and cross-component changes land out of order. A single shared application makes the opposite mistake: four people editing the same modules produces constant merge conflicts and makes it impossible to attribute code to a research contribution.

## Decision

One monorepo. One backend service per component, one frontend feature folder per component, one shared frontend application shell, one API gateway. Each member owns exactly one service directory and one feature directory and does not edit another member's.

CI is path filtered so a change under one service only runs that service's pipeline.

## Consequences

- Clear authorship for the individual research reports, since each component's code sits in its own directory.
- One clone, one pnpm install, one integrated demo.
- Cross-component boundaries must be made explicit (see ADR 0002), because the code is physically adjacent and the temptation to reach across is real.
- Shared areas (`contracts/`, `database/core/`, `frontend/src/shared/`, root config) need multi-owner approval, which is slower by design.
