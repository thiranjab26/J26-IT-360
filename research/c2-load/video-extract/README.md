# C2 P8: landmarks from DAiSEE videos (offline, not shipped)

Runs the app's own FaceMesh (adapter A: the self-hosted model files in `packages/load-sensor/public/models/facemesh/` and the same `createDetector` settings) over DAiSEE clips, in video mode like the app, and writes landmarks only. Plan and decisions: `docs/c2/TODO.md`, P8.

## Why it runs in WSL, with Node 22

- **Speed.** `@tensorflow/tfjs-node` runs native TensorFlow. Windows Smart App Control blocks native TensorFlow DLLs on the development laptop (see `research/c2-load/training/README.md`), so this runs in WSL2 Ubuntu.
- **Node 22 LTS, not 24.** tfjs-node 4.22.0 calls `util.isNullOrUndefined`, which Node 23 removed ("util_1.isNullOrUndefined is not a function").
- **One missing kernel added.** tfjs-node has no `Transform` kernel (`tf.image.transform`, used to crop the face region). `src/tfjs-node-transform.ts` maps it onto TensorFlow's `ImageProjectiveTransformV3`.

Parity, 30 Oct 2026, the first 2 clips (300 frames at 15 fps): tfjs-node vs TF.js `cpu` (the backend the image extractor used), max |Δ| = 0.0003 px, mean below 0.0001 px; a face in every frame on both.

## Setup (once, in Ubuntu)

Node 22 LTS in `~/.local/node22` (official tarball, SHA-256 checked), and `sudo apt-get install ffmpeg`.

## Running

From the repo root, in Ubuntu:

```bash
research/c2-load/video-extract/run.sh test        # unit tests
research/c2-load/video-extract/run.sh typecheck
research/c2-load/video-extract/run.sh --limit=20 --workers=4   # options below
```

`run.sh` mirrors this folder and the app files it reuses into `~/c2-video-extract` (same layout as the repo) and installs `node_modules` there, because tfjs-node's native TensorFlow is several hundred MB and must stay out of OneDrive. The repo stays the source of truth.

| Option | Default | |
|---|---|---|
| `--fps` | 15 | frames per second taken from each 30 fps clip (the app's rate) |
| `--backend` | `tensorflow` | `cpu` for the parity check |
| `--workers` | cores − 2, max 12 | parallel processes, clips split by index |
| `--limit` | all | first N clips only |
| `--root` | `/mnt/c/datasets/daisee/DAiSEE` | |
| `--out` | `/mnt/c/datasets/landmarks/daisee` | |

## Output

Per clip `<out>/<split>/<clip id>.npy`: float32 `[frames, 478, 3]`, NaN rows where no face was found, x / width, y / height, z / width (as `FaceResult`). Frame k is at k / fps s. Next to it `<clip id>.json` (frames, faces found, size, time). At the end `daisee.csv` and `daisee.summary.json`. No pixels are saved. A stopped run resumes: clips whose `.npy` exists are skipped.

Only clips with a label in the official `{Train,Validation,Test}Labels.csv` are processed (8,570: 8,571 labelled minus the one corrupt clip, `2100552061`).
