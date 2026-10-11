# Experiments

Model training and comparison. Every experiment reads the preprocessed data and
splits from `notebooks/01_preprocess_junyi.ipynb` and writes its outputs, with a
`manifest.json`, to Google Drive or `../results/`.

| File | Question it answers |
|---|---|
| `04_gat_train.ipynb` | How well does BKT + GAT predict the next response (AUC, accuracy, 5 folds)? |
| `05_baselines.ipynb` | How do BKT-only, DKT and GKT score on the same splits? |
| `06_ablations.ipynb` | Does the gain come from attention, and from prerequisite (not similarity) edges? |
| `07_faithfulness.ipynb` | Does removing the edge the explanation names change the prediction more than removing a random or the lowest-ranked edge? |
| `08_gain_analysis.ipynb` | Did the adaptive group gain more than the comparison group? (after the study) |
| `09_results.ipynb` | The results table: BKT, DKT, GKT and gat-v2 on identical test answers, student bootstrap and paired t-tests |

Model files are exported here as `gat-<version>.npz` plus a SHA-256, then copied
into `curriculum-service`. They are gitignored.
