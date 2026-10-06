# C1 research: Adaptive Curriculum Engine

Experiments behind the C1 claims: the prerequisite graph is reliable, BKT + GAT
predicts learner responses better than published baselines, the attention-based
explanation is faithful, and adaptive sequencing improves normalised learning
gain. Owner: Abeyrathne E.D.V.N (IT23265110).

**Nothing here is imported by `curriculum-service`.** Research produces one
model file (`gat-v1.npz` with its SHA-256) and results tables; the service only
loads that file.

## Layout

```
research/c1-curriculum/
├── README.md            this file
├── requirements.txt     libraries the notebooks install in Colab
├── notebooks/           numbered, run in order
├── experiments/         model training, baselines, ablations, statistics
├── annotation/          lecturer edge review and agreement (kappa)
├── results/             generated tables and figures (gitignored)
└── data/                local datasets (gitignored, created on first run)
```

## Pipeline

| Step | File | Produces | Feeds |
|---|---|---|---|
| 0 | `notebooks/00_explore_junyi.ipynb` | First look at the Junyi files | Appendix B (exploration) |
| 1 | `notebooks/01_preprocess_junyi.ipynb` | Clean answers, student splits, stats, manifest | every later step |
| 2 | `notebooks/02_graph_junyi.ipynb` | Junyi prerequisite graph, direction and agreement checks | GAT, Appendix B |
| 3 | `notebooks/03_bkt_baseline.ipynb` | pyBKT mastery per answer, BKT-only AUC | GAT features, baseline row |
| 4 | `experiments/04_gat_train.ipynb` | Trained GAT per fold, `gat-v1.npz` | service, results table |
| 5 | `experiments/05_baselines.ipynb` | DKT and GKT on the same splits | results table |
| 6 | `experiments/06_ablations.ipynb` | No attention; similarity vs prerequisite graph | research-gap evidence |
| 7 | `annotation/` | Lecturer edge review, Cohen's kappa | Objective 1 |
| 8 | `experiments/08_gain_analysis.ipynb` | Learning gain, treatment vs comparison | Objective 6 (after the study) |

Steps 2 onwards are added as they are built.

## Rules

1. **Split by student, never by row.** No student appears in both training and test.
2. **Fit on training folds only.** BKT parameters and any normalisation use training students only; the mastery fed to the GAT at time *t* uses answers before *t*.
3. **Fixed seeds** (42) and a `manifest.json` with settings, library versions and SHA-256 of every output, so each reported number can be traced to the exact data and code.
4. **Data stays out of git.** Datasets live in Google Drive (`adaptlearn-c1/`) or `data/`; only code, small annotation sheets and this documentation are committed.
5. **Clear notebook outputs before committing** (Edit > Clear all outputs).

## Running in Colab

1. Open https://colab.research.google.com, then File > Upload notebook (or open from GitHub).
2. Runtime > Change runtime type: CPU for notebooks 00 to 03, T4 GPU for training.
3. Runtime > Run all, and allow Google Drive access. Outputs are saved to
   `MyDrive/adaptlearn-c1/` so a disconnect does not lose them.

## Datasets

| Dataset | Use | Source |
|---|---|---|
| Junyi Academy | Primary: prerequisite graph, training, ablations | EduData `get_data("junyi")` |
| ASSISTments 2009 | Comparison with published baselines | after the Junyi results |
| EdNet | Scale check | after PP1 |

The datasets carry research-use licences: cite them, do not redistribute them.
