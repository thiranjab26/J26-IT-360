# C2 training (offline, not shipped)

Python code that trains C2's models and exports them to TF.js. Nothing here runs in the browser or in any service; only the exported `model.json` + weights are copied into `packages/load-sensor/public/models/`.

## Where it runs: WSL2, not Windows Python

The development laptop has Windows **Smart App Control** turned on. It refuses to load the native DLLs of TensorFlow, MediaPipe, pandas and parts of scikit-learn ("An Application Control policy has blocked this file", Code Integrity event 3077). Turning Smart App Control off cannot be undone without reinstalling Windows, so training runs in **WSL2 Ubuntu 24.04** instead. Smart App Control does not apply to Linux programs.

A second reason to use Linux: `tensorflowjs` depends on `tensorflow-decision-forests`, which has no Windows build.

## Setup (once)

From PowerShell:

```powershell
wsl --install -d Ubuntu-24.04
```

Inside Ubuntu (`wsl -d Ubuntu-24.04`):

```bash
sudo add-apt-repository -y ppa:deadsnakes/ppa
sudo apt-get update
sudo apt-get install -y python3.11 python3.11-venv python3.11-dev libgl1 libglib2.0-0
python3.11 -m venv ~/venvs/c2-training
cd /mnt/c/Users/<you>/OneDrive/Desktop/J26-IT-360/research/c2-load/training
~/venvs/c2-training/bin/pip install -r requirements.txt
```

The venv lives in the Linux home folder, not in the repo: TensorFlow is about 2 GB of small files, and OneDrive would try to sync them.

`requirements.txt` holds the direct dependencies with exact versions and explains each pin. `requirements.lock.txt` is the full `pip freeze` of a working install. Edit `requirements.txt`, reinstall, then regenerate the lock file.

## Running

Always set legacy Keras (CLAUDE.md: the TF.js converter does not handle Keras 3 layer models reliably):

```bash
export TF_USE_LEGACY_KERAS=1
```

Build models with `tf_keras`, not `keras`.

## Data

Public datasets live in `C:\datasets\` (`/mnt/c/datasets/` from WSL), outside the repo and outside OneDrive, because their licences forbid redistribution. Participant data never enters git either (CLAUDE.md invariant 7); `data/` and `training/data/` are gitignored as a backstop.

The plan for the trained expression, mood and head-pose models is Milestone P in `docs/c2/TODO.md`.
