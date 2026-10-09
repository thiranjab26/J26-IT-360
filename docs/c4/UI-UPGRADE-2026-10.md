# C4 UI upgrade, 8 Oct 2026

What the 8 Oct 2026 upgrade changed in the Intelligent Viva System (C4), why, and how it was checked.

Only C4 files changed: `frontend/src/features/viva`, `backend/services/viva-service` and `docs/c4`.
Nothing in C1, C2, C3 or the shared AdaptLearn shell was touched. Nothing is committed yet.

## Summary

| Area | What changed |
|---|---|
| Overview dashboard (new) | Admins land on a live dashboard: six tiles, four charts, a topics table, the newest sessions and quick links |
| Rating queue (new) | Evaluators land on their A, B and C progress, with one button into the blind review |
| Speech lab (new) | Upload a Zoom recording and see pauses, speed and fillers against the literature thresholds (the PP1-TODO task "Analyse a recording") |
| Session history | Summary tiles, a filter, an outcome colour per card, "25 min ago" dates and a coverage bar |
| Live viva | Space starts or stops recording, Ctrl + Enter submits; new questions slide in; the microphone pulses while recording |
| Report | The coverage ring fills, sections appear one after another, and Back returns to the page you came from |
| Speed | The viva no longer loads with the rest of AdaptLearn: the shared main bundle is 26% smaller (JS) and 74% smaller (CSS). Staff pages load only when opened |
| Polish | Page entrance animation, loading skeletons instead of spinners, visible keyboard focus, and no motion for people who ask for less |

## 1. Overview dashboard (admin)

Sign in through **Staff sign in** with the admin key. **Overview** is the first menu item and the
page you land on.

- **Tiles:** participants; sessions with a completion ring; answers split into spoken and typed;
  average rubric coverage with the average minutes per session; approved questions (opens the
  Question bank); blinded ratings and the number of raters (opens the Research dashboard).
- **Sessions in the last 14 days:** started and completed per day.
- **Outcomes:** a donut of completed sessions (no gap, likely knowledge gap, likely communication
  difficulty, mixed).
- **How answers were marked:** the six answer states.
- **Topics:** sessions, completed sessions and average coverage per topic.
- **Recent sessions:** the eight newest, with status, outcome and a **Report** button.
- **Quick links:** Question bank, Speech lab, Research dashboard. **Refresh** reloads the numbers.

The data comes from a new read-only endpoint, `GET /api/v1/viva/overview`. Evaluators get 403 from
it, so they never see system outcomes and the rating stays blind.

## 2. Rating queue (evaluator)

Evaluators land on **Your rating queue**: one card each for Condition A (initial answer),
B (follow-up evidence) and C (full available evidence), with a progress ring and "3 of 8 cases
rated", then **Open blind review**. It reads the existing `/evaluation/cases` endpoint; the
blinding is unchanged.

## 3. Speech lab (admin)

Open **Speech lab** in the staff menu.

1. Drop the student's Zoom audio (for example `P03_student.m4a`) in the left box.
   Optional: drop your own track (`P03_examiner.m4a`) in the right box. It splits the recording
   per question and adds response times.
2. Choose the transcription:
   - **Automatic (Groq when configured)**.
   - **Groq: adds fillers and pause positions.** The audio is sent to Groq, so use it only if the
     consent covers cloud transcription.
   - **Sound only: private, no words.** Nothing leaves the computer. Fillers are not available,
     and syllables are counted from the sound, which misses about 20%.
3. Press **Analyse recording**. A one-minute file takes about a second in sound-only mode.

The results:

- A verdict: how many of the four core measures are beyond the literature thresholds (two or more
  match the communication-difficulty pattern). It is marked provisional, because the thresholds
  come from L2 English monologues, not technical vivas.
- Four measure cards (speech rate, articulation rate, mean length of run, mean silent pause),
  each with a scale and the threshold marked.
- Other measures, marked exploratory.
- A timeline: speech rate per 15-second window, with pauses as a strip below.
- A per-answer table (when the examiner track is given).
- The transcript, with fillers highlighted and pauses of 0.5 s or more shown where they happened.
- Notes, and **Download the full analysis (JSON)**.

Limits: 20 MB and 30 minutes per file; M4A, MP3, WAV, WebM, MP4, OGG or FLAC. The audio is
analysed in memory and never stored. The page uses the same analysis code as
`scripts/analyze_recordings.py` (the new shared module `app/integrations/recording.py`). For the
study statistics, keep using the batch tool with CrisperWhisper word timings. The lab is for a
quick look and for the PP1 demo.

## 4. Session history

- Four summary tiles that count up: sessions, completed, in progress and average coverage.
- A filter: All, In progress, Completed, with counts.
- A coloured edge and label on each card: blue in progress, green no gap, red knowledge gap,
  amber communication difficulty, grey mixed.
- Relative dates ("25 min ago"; hover for the full date) and a coverage bar on completed sessions.
- Loading skeletons. The buttons are unchanged: **Resume session** and **View report**.

## 5. Live viva

- **Keyboard:** Space starts or stops recording (speech mode only; never while typing in a box or
  when a button has focus). Ctrl + Enter (Cmd + Enter on a Mac) submits. A hint line shows the keys.
- Each new question rises in, the microphone pulses while recording, and answers fade in.
- The viva logic is unchanged: the same questions, follow-up policy, scoring, gap rules and voice.

## 6. Report

- The coverage ring fills and its number counts up; the sections appear one after another.
- The Back link shows the arrow and text on one line (the arrow was stacked above it). Back returns
  to the page that opened the report (history or overview).
- Printing and Save as PDF switch the animations off, so printed reports are complete.

## 7. Faster loading

| Production build | Before | After |
|---|---|---|
| Shared main JavaScript (every AdaptLearn page) | 362.33 kB (110.78 kB gzip) | 267.53 kB (85.10 kB gzip) |
| Shared main CSS | 71.93 kB | 18.91 kB |
| Viva app, loaded when /viva opens | inside the main bundle | 64.8 kB JS, 61.4 kB CSS |
| Overview, Speech lab, Question bank, Research, Report | inside the main bundle | 11.9, 10.5, 23.6, 8.8 and 8.5 kB, each loaded when opened |

Every AdaptLearn page, C1 to C3 included, now downloads about 95 kB less JavaScript and 53 kB less
CSS on first load, because the viva only loads when someone opens `/viva`. Only the viva's own
`routes.tsx` changed to do this. Participants never download the staff pages.

## 8. Motion and accessibility

- All motion is in one file, `styles/motion.css`, scoped to the viva.
- Animations end in the normal state and never leave a transform behind, so dialogs stay in place.
- Reduced motion: when the computer asks for less motion, all animations and count-ups are skipped.
- A visible focus ring on buttons, menu items and tabs for keyboard users.
- Phone width (390 px): tiles stack, wide tables scroll inside their card, and the page never
  scrolls sideways.

## 9. Small fixes found during testing

- Welcome page: the closing line no longer overlaps the orbit drawing.
- "1 questions asked" now reads "1 question asked".
- A 0% progress ring no longer shows a dot; the evaluator card titles fit on one line.
- Overview: days with no sessions show no stray marks; short sessions read "Under a minute per
  session".
- When the service is down, the message says what to do: start viva-service (port 8401), then refresh.
- Speech lab: a clear message when the audio packages are missing, instead of "could not be decoded".
- Typed answers: the note under the box now says that Ctrl + Enter submits.

## 10. Backend changes

| File | Change |
|---|---|
| `app/api/v1/routes/overview.py` (new) | `GET /overview`: admin only, read only |
| `app/api/v1/routes/lab.py` (new) | `POST /lab/analyse`: admin only |
| `app/integrations/recording.py` (new) | The shared analysis core for the lab and the batch tool |
| `scripts/analyze_recordings.py` | Calls the shared core; its output files were byte-identical before and after |
| `app/api/v1/routes/sessions.py` | Session list items also carry `coverage` and `strong` (new fields only) |
| `app/api/v1/router.py` | Registers the two new routes |
| `tests/integration/test_dashboard.py` (new) | Five tests: overview access and counts, coverage in the list, lab analysis, lab rejects non-audio, lab explains a missing package |

No database change: no new tables or columns, and no migration. Existing API fields are unchanged.

## 11. Frontend changes

| File | Change |
|---|---|
| `routes.tsx` | Loads the viva on demand |
| `pages/VivaApp.tsx` | The shell: Overview and Speech lab in the menu, staff pages loaded on demand, page transitions, scroll to top, clearer errors, version v1.1 |
| `pages/StaffHome.tsx` (new) | Overview dashboard and evaluator rating queue |
| `pages/SpeechLab.tsx` (new) | Speech lab |
| `pages/History.tsx` (new) | Session history, moved out of `VivaApp.tsx` and upgraded |
| `pages/Bank.tsx`, `pages/Research.tsx` (new) | Moved out of `Staff.tsx`; only the loading skeletons changed |
| `pages/Welcome.tsx`, `components/StaffLogin.tsx` (new) | Moved out of `VivaApp.tsx` unchanged |
| `pages/Staff.tsx` (deleted) | Split into `Bank.tsx` and `Research.tsx` |
| `pages/Workspace.tsx` | Keyboard shortcuts and hints |
| `pages/ReportView.tsx` | Animated ring and sections |
| `components/charts.tsx` (new) | Small SVG charts with no library: count-up, donut, columns, bars, ring, meter, timeline |
| `components/components.tsx` | `Skeleton` loader |
| `api/client.ts`, `api/types.ts` | `ago()` for relative dates; types for the overview and the lab |
| `styles/motion.css`, `styles/dashboard.css` (new) | Motion and dashboard styles, scoped to `.viva-app` |

No new npm or Python packages were added for the upgrade.

## 12. How it was tested

- **Backend:** `ruff check`, `ruff format --check` and `pytest` all pass: 87 passed (82 before,
  plus 5 new).
- **Frontend:** the strict TypeScript check and the production build pass.
- **Isolated copy:** a separate SQLite database, demo AI and speech switched off, on ports 8402
  and 5199. No real data or API credit was used.
- **Screenshots:** headless Edge captured every changed page at desktop width (1440 px) and phone
  width (390 px), plus a reduced-motion run, with no browser errors.
- **Click-through:** as a participant, resume a session, start the viva, switch to typing, submit
  with Ctrl + Enter and see the follow-up load. As admin, analyse a 66-second two-track test
  recording in the Speech lab: 200 OK in 1.2 s, 3 of 4 core measures flagged, and the page shows
  the same numbers as the downloaded JSON.

## 13. How to run it

The backend now needs the audio extras for the Speech lab:

```bash
cd backend/services/viva-service
uv run --extra speech --extra research uvicorn app.main:app --reload --port 8401
```

The frontend is unchanged (`pnpm --filter frontend dev`). Open `http://localhost:5173/viva`, use
**Staff sign in** with the admin key, and you land on the Overview.

## 14. Not done, and notes

- The Speech lab does not read CrisperWhisper JSON files; the batch tool does. An optional
  word-file upload can be added if it is needed for the demo.
- The Overview refreshes when you press **Refresh**, not live.
- `frontend/vite.config.ts.timestamp-…mjs` is a leftover Vite temporary file from an earlier run,
  not part of this work. Delete it or leave it out of the commit.

When you commit, the upgrade is the files in sections 10 and 11 plus `docs/c4`. The research tooling
from earlier the same day is separate: `app/domain/fluency.py`, `app/integrations/syllables.py`,
`app/integrations/speech.py`, `pyproject.toml`, `uv.lock`, `scripts/`, `tests/unit/test_fluency.py`
and `research/c4-viva/`.

## 15. Rollback

A rollback kit sits outside the repository, so it is never committed:
`Intelligent Viva System/C4-rollback-ui-upgrade-2026-10-08/`. Its `README.md` lists every added,
changed and removed file with the exact before and after, and `rollback.py` undoes all of it or
part of it. Edits made after the upgrade are kept.
