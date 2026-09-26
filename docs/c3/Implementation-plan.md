## 9. C3 tutor-service Internal Structure

Built on the service template, with each pipeline layer as its own package.

```text
tutor-service/
├── app/
│   ├── main.py
│   ├── config.py
│   ├── api/v1/routes/
│   │   ├── health.py
│   │   ├── sessions.py          # start, next, answer, end, resume
│   │   ├── practicals.py        # generate, submit
│   │   ├── progress.py          # xp, badges, quest map, dashboard data
│   │   ├── content.py           # admin: re-index, list units
│   │   └── internal.py          # /internal/load
│   │
│   ├── content/                 # Layers 1-2: ingestion and indexing
│   │   ├── loader.py            # reads markdown units + frontmatter
│   │   ├── chunker.py
│   │   ├── embedder.py
│   │   └── indexer.py           # writes Chroma collections AND content schema rows
│   │
│   ├── retrieval/
│   │   └── retriever.py         # namespace-scoped similarity search
│   │
│   ├── generation/              # Layer 3
│   │   ├── providers/
│   │   │   ├── base.py          # LLMProvider protocol
│   │   │   ├── openai_provider.py
│   │   │   ├── gemini_provider.py
│   │   │   ├── ollama_provider.py
│   │   │   └── router.py        # picks cloud or local by connectivity
│   │   ├── prompts/             # versioned prompt templates per mode
│   │   └── modes/
│   │       ├── tutor_session.py
│   │       ├── practical_generator.py
│   │       └── auto_grader.py
│   │
│   ├── verification/            # Layer 4, the research core
│   │   ├── decomposer.py        # output -> atomic claims
│   │   ├── nli/
│   │   │   ├── base.py          # NLIModel protocol
│   │   │   ├── deberta.py
│   │   │   └── hhem.py
│   │   ├── premise_window.py    # handles the 512-token limit
│   │   └── gate.py              # verify, block, regenerate, re-verify
│   │
│   ├── sessions/                # Layer 5, session side
│   │   ├── state_machine.py     # typed exits, resume window
│   │   └── checkpoints.py
│   ├── gamification/            # Layer 5, reward side
│   │   ├── engine.py
│   │   ├── rules.py             # mastery-gated unlock rules
│   │   ├── xp.py
│   │   └── badges.py
│   ├── adaptation/
│   │   └── load_conditioner.py  # load state -> generation parameters
│   │
│   ├── grading/
│   │   └── code_runner.py       # client for Piston, hidden tests
│   │
│   ├── integrations/
│   │   ├── mastery_reader.py    # reads curriculum views; stub + live
│   │   └── load_receiver.py     # handles pushed load signals; stub + live
│   │
│   ├── models/                  # Pydantic schemas
│   └── db/
│       ├── session.py
│       ├── tables.py            # content and tutor schema tables
│       └── repositories/        # units, sessions, attempts, progress, gate_events
│
├── migrations/                  # Alembic for content and tutor schemas, incl. published views
├── content/                     # authored course material, version controlled
│   └── dsa/
│       ├── t01-complexity/
│       │   ├── u01-counting-operations.md
│       │   └── ...
│       ├── t04-recursion/
│       └── practicals/
│           └── t04-descent.yaml # practical spec + hidden tests
├── .chroma/                     # embedded vector store data, gitignored
├── tests/
│   ├── unit/
│   │   ├── test_chunker.py
│   │   ├── test_decomposer.py
│   │   ├── test_gate.py
│   │   ├── test_state_machine.py
│   │   └── test_unlock_rules.py
│   └── integration/
├── .python-version
├── pyproject.toml
├── .env.example
└── README.md
```

**Content unit format**

```markdown
---
unit_id: dsa.t04.u02
module: dsa
topic: recursion
title: Base Case and Recursive Case
covers_concept_ids: [recursion.base_case, recursion.recursive_case]
difficulty: 2
prerequisites: [dsa.t03.u03]
---

Theory text, code blocks and diagram references go here.
```

Keeping content as Markdown in the repo means every evaluation run can be tied to an exact content version, which matters for reproducibility of the faithfulness results. Concept IDs in the frontmatter must exist in `core.concepts`; the indexer rejects unknown IDs.

---

## 10. C3 Implementation Plan

Phases are ordered by dependency and risk, matching Section 3.6 of the proposal. Integration with C1, C2 and C4 is deliberately the last build phase; until then every cross-component read comes from stubs.

| Phase | Period | Work | Exit criterion |
|---|---|---|---|
| **P0 Foundation** | Late Sep to mid Oct 2026 | Monorepo scaffold, service template, gateway routing and JWT check, minimal auth-service; Neon project with schemas, service roles and `core` migrations; concept list agreed with C1; per-member Neon branches; CI and CODEOWNERS; contract drafts | Every member can clone, `uv sync`, migrate their schema on their own branch, and hit their `/health` through the gateway |
| **P1 Content and retrieval** | Mid Oct to mid Nov | Content unit format; author DSA T1 to T4 first (T4 Recursion is the pivot topic), then T5 to T7; loader, chunker, embedder; indexer writing Chroma and `content` rows; retrieval evaluation on held-out concept queries | Retrieval precision and recall reported; module namespace isolation tested |
| **P2 Generation and sessions** | Mid Nov to mid Dec | Provider protocol with OpenAI/Gemini and Ollama; connectivity router; prompt templates; session state machine with typed exits and resume; checkpoints (MCQ, trace, predict, explain); minimal session UI | A full guided session runs end to end on T4, online and offline |
| **P3 Faithfulness gate** | Mid Dec to early Jan 2027 | Claim decomposer (LLM-based, plus a rule-based sentence splitter as baseline); DeBERTa and HHEM verifiers behind one protocol; premise windowing for the token limit; gate with capped regeneration loop; gate event logging | Tutor-session output is verified claim by claim; blocked claims and latency are logged |
| **PP1 milestone** | Jan 2027 | Tag `pp1` on `main` | Demo: retrieval, guided session, gate on tutoring mode (about 50%) |
| **P4 Practicals and grading** | Jan to mid Feb | Practical generator (scenario, debugging, code completion, comparative); Piston code runner with hidden tests; free-text auto-grader; gate applied to both modes | All three modes pass through the same gate |
| **P5 Gamification and dashboard** | Feb | XP per checkpoint, badges, quests, boss checkpoints; unlock rules against stubbed mastery; load conditioner against stubbed load; dashboard, quest map and verification chip in the UI | Unlocks respond to mastery values; generation depth changes with load state |
| **P6 Evaluation set and experiments** | Feb to Mar | Annotation guideline; labelling tool in `research/`; generate about 180 outputs under normal and degraded retrieval; label; re-label 15% after a gap; NLI model comparison; claim-level vs whole-response ablation; latency measurement | Labelled dataset, Cohen's kappa, and ablation results exist |
| **PP2 milestone** | Mar 2027 | Tag `pp2` on `main` | Demo: all modes gated, gamification working, first experimental results (about 90%) |
| **P7 Integrations** | Mar to Apr | Switch `INTEGRATION_MODE=live`: read `curriculum.v_mastery` and `v_next_topic`; publish `content.v_unit_manifest`, `content.v_verified_passages` and `tutor.v_attempt_outcomes` to live consumers; receive the C2 load signal; end-to-end auth through the gateway; cross-component integration tests; learning-gain study with the student cohort | All contracts pass integration tests against real services |
| **P8 Hardening** | Apr to May | System testing, UAT, deployment, results analysis, final report | Tag `final` on `main` |

**Why this order holds up**

- Retrieval is validated before generation, so any hallucination found later can be attributed to generation rather than bad retrieval.
- The gate is proven on one mode before being extended to the other two.
- The evaluation set does not depend on any other component, so it runs in parallel with integration risk rather than behind it.
- Stubs mean C3 reaches PP2 at roughly 90% even if another component slips.
- Your published views can exist from P1 onward even though C1 and C4 only consume them in P7, so they can start reading real data whenever they are ready.

---