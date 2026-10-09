# C4 research: communication difficulty in L2 technical vivas

PP1 pilot (October 2026). The question: when knowledge is controlled, which speech fluency
measures separate Sri Lankan undergraduates who have communication difficulty in English
technical vivas from those who do not, and at what thresholds? Background, decisions and the
literature are in `docs/c4/research-scope-change.md`; the day plan is `docs/c4/PP1-TODO.md`.

## Design

- 5 + 5 students (communication difficulty vs comfortable, by their own self-report), all with
  at least 60% on a 10-question MCQ, so weak answers are not knowledge gaps.
- A scripted 10-minute viva on Zoom: the researcher asks five DSA questions with fixed
  follow-ups; an observer rates each answer. Zoom saves each voice in its own file.
- Measures from the student's voice: silent pauses (250 ms or more), speech and articulation
  rate, mean length of run, share of mid-clause pauses, filled pauses, response latency.
- Primary measures (hypothesis H1): speech rate, mean length of run, mean silent pause, silent
  pauses per minute. Everything else is exploratory, including the share of mid-clause pauses,
  which depends on the transcript (transcribers put commas exactly where people pause).
- Thresholds: a literature profile for PP1, compared with cut-offs derived from the pilot;
  leave-one-out accuracy now, new students in PP2.

## Folders

| Folder | Contents |
|---|---|
| `study/` | Viva script, MCQ, Google Form text, observer form, Zoom set-up, ethics form draft, participants template |
| `analysis/` | `run_stats.py` (statistics and charts) and `crisperwhisper_colab.ipynb` (filler-aware transcripts) |

The measurement code lives in viva-service so the system can use the same thresholds:
`app/domain/fluency.py` (measures and the literature profile), `app/integrations/syllables.py`
(syllable detection) and `scripts/analyze_recordings.py` (the command below).

## Running the analysis

Keep the recordings and `participants.csv` **outside this repository**, for example in
`Documents/viva-study/recordings`. Never commit recordings or participant data.

```bash
cd backend/services/viva-service
uv sync --extra speech --extra research

# 1. Optional, best filler detection: run analysis/crisperwhisper_colab.ipynb on Colab and
#    unzip the *.words.json files next to the recordings.

# 2. Measures for every participant (writes RECORDINGS/results/*.csv)
uv run --extra speech --extra research python scripts/analyze_recordings.py "C:/Users/MSII/Documents/viva-study/recordings"
#    without CrisperWhisper files: add --transcriber groq (fast, cloud) or keep local (private)
#    with a warm-up question: add --warmup

# 3. Counting check: fill your_fillers and your_pauses in results/count_check.csv

# 4. Statistics, charts and report.md
uv run --extra research python ../../../research/c4-viva/analysis/run_stats.py \
    "C:/Users/MSII/Documents/viva-study/recordings/results" \
    "C:/Users/MSII/Documents/viva-study/participants.csv"
```

## The earlier A/B/C design

The system still contains the blinded rater workspace and A/B/C metrics from the September
proposal (`/api/v1/viva/evaluation/*`). They are not part of the PP1 pilot after the
supervisor's change of scope on 8 Oct 2026.
