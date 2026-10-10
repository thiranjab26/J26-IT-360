# Research

Notebooks, labelling tools, datasets and experiment scripts. **Nothing here is imported by a running service**, and no service code depends on this folder.

| Folder | Owner |
|---|---|
| `c1-curriculum/` | C1 |
| `c2-load/` | C2 |
| `c3-RAG tutor/` | C3 |
| `c4-viva/` | C4 |

Inside a component folder, the convention C3 uses (copy it if it fits):

```
notebooks/     exploratory analysis
annotation/    guideline, labelling tool, labelled data
experiments/   ablation and model-comparison scripts
results/       generated outputs (gitignored except .gitkeep)
```

Generated outputs under `results/` are ignored by git. Commit the script that produces them and, where it is small enough to review, the labelled data itself, so every reported number can be regenerated from a known content and code version.
