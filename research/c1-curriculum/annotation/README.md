# Prerequisite edge review (Objective 1)

Two subject lecturers independently review every prerequisite edge in the
AdaptLearn concept graph. Agreement is reported as Cohen's kappa (target at
least 0.70). An edge the reviewers disagree on is resolved by discussion or
removed.

## Files (added as the review happens)

| File | Contents |
|---|---|
| `edge_review_form.csv` | One row per edge: `concept_id`, `prerequisite_id`, names, blank verdict column |
| `reviewer_a.csv`, `reviewer_b.csv` | Each lecturer's verdicts: `agree`, `disagree`, plus any missing edges they propose |
| `kappa.py` | Computes Cohen's kappa and lists disagreements |
| `resolution.md` | How each disagreement was settled, with dates |

Reviewer files contain no personal data beyond the reviewer label (A or B).
These CSVs are small and are committed: they are the evidence behind the kappa
claim.
