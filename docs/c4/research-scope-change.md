# C4 research scope change

Recorded on 8 Oct 2026 by the owner, from a 20-minute supervisor meeting. Status: **direction
known; open questions listed below**. Full plan:
https://claude.ai/artifact/2MbK7fM9rcCVWtc9zg96uv (private page, owner's account).

## What happened

The supervisor judged that a viva system built by calling existing AI and speech APIs shows no
research contribution. The research now centres on **detecting communication difficulty when Sri
Lankan undergraduates answer technical viva questions in English (a second language)**, with
thresholds the owner derives from collected data and tests statistically. The viva system stays as
the data-collection instrument and the place the thresholds are applied.

Until the open questions below are settled:

- Do not change the research rules (`POLICY_VERSION`, `GAP_VERSION`, `HESITATION_SIGNALS` in
  `backend/services/viva-service/app/domain/logic.py`) or the evaluation code
  (`app/domain/research.py`) without the owner's go-ahead on the plan.

## New deadline and PP1 scope (owner, 8 Oct 2026)

- PP1 is on Wednesday 21 Oct 2026. Everything must be finished by Tuesday 20 Oct.
- Ignore the dates in the proposal's Gantt chart.
- Now required **before PP1** (the proposal had these later):
  - a pilot with **at least 10 students** (possibly 20 to 30 participants);
  - calibrating the hesitation thresholds on the pilot data;
  - measuring and reporting results.
- PP2 is unchanged and still later: live integration with C1 to C3, the shared login and the team
  Neon branch.

## The supervisor's changes

| Area | Before (September 2026 proposal) | After (supervisor, 8 Oct 2026) |
|---|---|---|
| Research question | Can rubric assessment, deterministic follow-ups and hesitation evidence tell a likely knowledge gap from a likely communication difficulty? | How can communication difficulty be detected reliably in L2 English technical vivas, and which thresholds separate it from normal speech? |
| Contribution | The combination of the three, compared with human raters under conditions A, B and C | The owner's own dataset, a detector checked on it, and thresholds derived from it and tested statistically |
| Hesitation | Supplementary evidence only | The main evidence for communication difficulty (filler counts alone are not enough) |
| Thresholds | Prototype guesses | PP1: literature-based; then derived from collected data (group comparison) and validated on new students |
| Knowledge control | Rubric marking in the viva | MCQ pre-test before the viva; only students with average or better knowledge are recorded |
| Ground truth | Two blinded raters | Purposive groups (with and without communication difficulty, from screening), plus an observer present in every session |
| Participants | 20 to 30 after ethics | 10 + 10 for PP1 (minimum 5 + 5); 15 + 15 or more in total by PP2 |
| Analysis | A/B/C metrics | Whole 10-minute sessions, per question and per 15-second window; counts of pauses, fillers and silences turned into thresholds |
| "Model" | LLM marks answers | A detector that identifies fillers, pauses (and possibly "jargon") during the viva; trained on public datasets, validated on the collected recordings |
| Questions | Course-bank questions | The system's technical (DSA) questions, at the MCQ's difficulty |

## Owner decisions (9 Oct 2026)

- 5 + 5 students for PP1 (communication difficulty vs comfortable); more in PP2.
- English only (no Sinhala or Tamil measures); "jargon" dropped; voice only, no video.
- Groups come from the students' own answers (self-report), checked by an observer.
- SLIIT Preliminary Ethics Review Form, plus written consent that names Groq transcription.
- Data structures questions (stacks, queues); the project title stays the same (the work
  deepens proposal objective 3).
- Study vivas are run **manually** by the owner on Zoom from a fixed script (5 questions, scripted
  follow-ups A and B chosen by the deterministic rule), with an observer in the call. Zoom local
  recording saves each participant's audio separately; "Original sound" stays on. Reason: the
  live system's delays, voice and follow-ups would add pauses of their own to the data.
- No study mode is needed; the Zoom files are the saved recordings (owner's laptop only).
- A simple counting check (1 minute per student, tally of fillers and silences) replaces
  Audacity labelling for PP1.
- Build instead: an analysis tool for the recordings, the literature threshold profile, a
  statistics notebook, and a counting-check helper.
- Keep the knowledge-gap part; keep data export small.
- Deepgram stays switched off, not deleted.
- Transcription: Groq Whisper live; CrisperWhisper offline re-run on saved study recordings.

## Remaining choices (owner, 9 Oct 2026)

No further supervisor input is available. The owner decided: existing detectors (Whisper,
CrisperWhisper, voice activity detection), checked against the counting check, for PP1; a trained
detector in PP2. The warm-up question stays optional and is not analysed separately.

## What exists today that the change may affect

| Part | Where | Current behaviour |
|---|---|---|
| Follow-up policy `c04-policy-1.3-skip-stop` | `logic.py`: `policy()`, `next_question()` | Fixed table from answer state to next action; at most 2 follow-ups per concept (1 when C2 reports high load); at most 6 concepts; skip and "stop the session" |
| Gap rules `c04-gap-1.3-verbal-signal` | `logic.py`: `differentiate()` | Conservative; three outcomes; conditions A, B and C |
| Hesitation thresholds | `logic.py`: `HESITATION_SIGNALS`, `SIGNAL_INFO` | Latency 3,000 ms or more; pauses averaging 1.5 s or more, or 3 or more over 2 s; fillers 8 or more per 100 words; restarts 2 or more; hedges 2 or more. "High hesitation" needs 2 or more signals |
| Evaluation | `research.py`; Research dashboard in `frontend/src/features/viva/pages/Staff.tsx` | Blinded rater cases under A, B and C; accuracy, macro F1, Cohen's kappa, inter-rater kappa; JSON export |

## Correction to the PP1 status page (8 Oct 2026)

The first version of the status page said "Condition A always gives Mixed". That came from an old
handover snapshot and is wrong for the current code. Under gap rules 1.3, condition A (first answer
only) gives:

- Likely knowledge gap when the first answer is incorrect, holds a misconception or is a non-answer;
- Mixed when the first answer is partly correct or too shallow;
- Mixed with "no weakness" when the first answer is complete.

It never gives Likely communication difficulty. That is by design: one answer has no follow-up or
hesitation evidence to show it. No code was changed.

## Risks to settle with the supervisor

- Ethics approval and consent wording before any student takes part.
- Who the two raters are, and when they rate the pilot sessions.
- Setting the thresholds and measuring results on the same 10 students makes the results look
  better than they are. Either split the students (for example, set thresholds on the first 5 and
  measure on the rest) or report this as a limitation.
- Where students take the viva (a quiet room, a working microphone), and the Groq free tier
  (about 4 answers per minute), which allows one student at a time.
