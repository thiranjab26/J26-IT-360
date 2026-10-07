# C4 research: A/B/C evaluation

Research material for the C4 Intelligent Viva System. Nothing here is imported by `viva-service`.

## Study design

- Design Science Research with a controlled quantitative evaluation, about 20 to 30 IT/CS undergraduates, subject to ethics approval.
- Two independent human raters label each answer's state (6 classes) and each concept's gap outcome (3 classes), without seeing the system's decision. C1 mastery is shown to raters as reference only.
- The same recordings are scored under three evidence conditions: **A** first answer only, **B** answers plus follow-ups, **C** answers, follow-ups and hesitation signals.
- Metrics per condition: accuracy, macro F1 and Cohen's kappa against the raters, inter-rater kappa, follow-up appropriateness (1 to 5) and feedback usefulness (1 to 5).

## Where the data comes from

- Rater cases and ratings: `GET /api/v1/viva/evaluation/cases?condition=A|B|C`, `POST /api/v1/viva/evaluation/ratings` (evaluator login).
- Metrics: `GET /api/v1/viva/evaluation/metrics`. Pseudonymised export: `GET /api/v1/viva/evaluation/export` (admin login).
- Every session stores its policy and gap-rule versions (`c04-policy-1.3-skip-stop`, `c04-gap-1.3-verbal-signal`).

## Before the main study

1. A lecturer reviews the question bank, rubrics, misconceptions and probes.
2. Pilot with a few students, calibrate the hesitation thresholds (`app/domain/logic.py`, `HESITATION_SIGNALS`), then freeze the rule version.
3. Keep pilot data separate from the main evaluation data.

Put notebooks, rater instructions and analysis scripts in this folder.
