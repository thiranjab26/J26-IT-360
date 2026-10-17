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

## 16. Live viva changes (12 Oct 2026)

A redesign (navy palette, video-call tile, new portrait, boxed record bar) was tried and reverted
the same day at the owner's request: the earlier colours, mascot and round microphone button are
back. What stayed:

- A slim live waveform under the microphone button while recording (`components/voice.tsx`,
  drawn on a canvas every animation frame, outside React state).
- One voice per session (`useSpeech.ts`): once the Groq voice has played, the browser voice is
  never mixed in; a failed clip is retried once, then the question stays on screen with a
  "Listen again" prompt. The browser voice is used throughout only when the server has no cloud voice.
- Speech lab: optional CrisperWhisper words file (exact fillers and repairs), and the repair,
  lexical-filler and word-search measures.
- Copies of the files from before these changes: `Intelligent Viva System/C4-backups/ui-2026-10-12/`.
- Friendly touches for students: an optional microphone check on the "Ready" screen (wave and a
  tick, then the mic is released); a "Slower" button that replays the question at 0.8 speed in
  the same voice; question dots instead of the bar and "Question 2 of 5"; a neutral "Thank you.
  Here is the next question." between questions; and a short celebration on the report straight
  after a viva (for finishing, never for being right; not shown when a report is opened from history).

## 17. Separate student and lecturer pages (15 Oct 2026)

The single page with a mixed sidebar and a "Staff sign in" pop-up became two pages. Colours, fonts,
cards and the mascot are unchanged.

| Page | Address | What it has |
|---|---|---|
| Student | `/viva` (`/viva/history` for "My vivas") | A slim top bar (logo, Viva and My vivas tabs, the participant code, sign out), a centred sign-in page, the viva, the report, and a footer link to the lecturer page |
| Lecturer | `/viva/lecturer` (`/vivas`, `/questions`, `/speech-lab`, `/research`) | A full sign-in page (Lecturer or Rater and an access key), then the sidebar: Overview, Student vivas, Question bank, Speech lab, Research; a rater sees only the rating queue and blind review |

- Each page keeps its own sign-in for the browser tab (`adaptlearn-auth-v1` for students,
  `adaptlearn-staff-auth-v1` for lecturers), so both can be open side by side. Each top-level page
  has its own address, so refresh and the back button work.
- Demo wording removed: "Research workspace v1.1", "Research prototype", "C04 / Component 04",
  the "Built for understanding" card, the provider footer and the "About this workspace" pop-up,
  "e.g. learner-042", the "research prototype" consent text, the voice-provider chip and
  "Transcribed by ..." during the viva, and "built-in sample" labels.
- Students no longer see the C1 to C3 learning-context panel. Lecturers see it, as saved when the
  viva started, at the bottom of each student report, with an "Export data" button. Students
  get "Print or save as PDF" only.
- New lecturer "Student vivas" page: every viva with the participant code, a search box and the
  report. `GET /sessions` now returns `participant_code` (all codes for staff, the student's own
  for a student); covered by `test_session_list_includes_coverage`.
- The service and provider details moved to a "System" panel at the bottom of the lecturer
  Overview; the lecturer top bar shows "Service online" or "Service offline".
- Code: `pages/StudentApp.tsx` and `pages/LecturerApp.tsx` replace `pages/VivaApp.tsx`;
  `hooks/useViva.ts` holds the shared sign-in and service hooks; `components/StaffLogin.tsx` is now
  the lecturer sign-in page; unused CSS for the old welcome page and sidebar card was removed.
- Checked: typecheck and build pass, 107 backend tests pass; every page clicked through at desktop
  and phone size against a throwaway test backend (temporary database, demo keys).
- Undo: `Intelligent Viva System/C4-backups/ui-2026-10-15/README.txt` (restores the frontend
  feature folder and the router), and revert the `participant_code` lines in
  `app/api/v1/routes/sessions.py` and the test.

## 18. Fit to the screen, the viva rail, and provider fixes (15 Oct 2026)

- The owner's browser window is about 1536 x 710 (1920 x 1080 at 125 % scaling). The sign-in,
  start, viva and "My vivas" pages now fit that window and a 1366 x 640 laptop without page
  scrolling; only the report (long by nature) and phones scroll. Cards scroll inside only when
  their own content is longer. The footer shows on the sign-in page only.
- Start page: topics in a grid on the left (scrolls inside when there are many), and a "Your
  viva" panel on the right (Speak or Type, what to expect, Start).
- Viva page (owner's choice of layout): a progress rail on the left (each question done, current
  or to come, a tip, previous answers, Save & leave, Finish) and one card with the examiner and
  the question on top and the answer (recorder, transcript, Submit) underneath. Turns now carry
  their `concept` so the rail can name answered questions.
- The report's result and coverage ring share the first card.
- Fixes: the browser voice "Slower" button (Chrome dropped speech started straight after
  `cancel()`); a rejected API key (401 or 403) is skipped for 2 minutes instead of being tried on
  every answer (`test_rejected_key_is_skipped_on_later_calls`); students see a plain "marking is
  busy, press Submit again" message instead of the provider error, and "Still marking your
  answer" after 12 seconds.
- Cause of the slow, failing answers on 15 Oct: the Groq key in `.env` returned 401 for marking,
  speech-to-text and the voice, so every answer fell back to Gemini, which was returning 503
  (high demand). Fix: a valid Groq key in `.env`, then restart the backend.

## 19. Clearer results, two plans, course groups and one font (15 Oct 2026)

- Result wording (owner's choice): the research category `MIXED_INSUFFICIENT_EVIDENCE` is unchanged,
  but readers now see "Mixed results" when some topic gave a clear result and "Not enough evidence
  yet" when none did (`result_label()` in `logic.py`, sent as `result` on reports, the viva list and
  the lecturer overview, with `results` counts beside the research `outcomes`). A single topic that
  is mixed reads "Not enough evidence". Blind-review options keep the research wording.
- Plans: each report has a study plan (what to revise, naming the missed points and the review
  material) and a speaking plan (how to explain out loud, chosen from fillers and time to first
  word). Groq writes both when it is available; otherwise the rule-based plans in `logic.py` are
  used. `improvement_plan` still holds both lists for exports.
- Review material names drop the "C3 " prefix and the file extension.
- Report: one card per section with an icon and a one-line description; facts (questions,
  follow-ups, spoken or typed); a coverage bar per topic; plain help text under each speaking
  measure. "About this report" became "How this works" (three plain sentences); lecturers also
  see the research notes there under "Method notes".
- Start page: topics grouped by module (IT1010 first), a search box, a course-code badge, and a
  "Before you start" checklist. The topic list sends `code`, `module`, `short_name` and `summary`
  for C3 courses. The 4 old sample topics were hidden (`scripts/hide_sample_topics.py --apply`;
  backup `C4-db-backups/viva-backup-2026-10-15-2310.json`; undo by approving them again).
- Viva rail tip: a short heading and two lines. Font: Geist (as in the rest of AdaptLearn), weights
  400 to 700, loaded by `viva.css`; Inter and the system font are fallbacks. "My vivas" uses the
  student titles, cards and buttons.
- Checked: typecheck and build pass, 110 backend tests pass; every page screenshotted at 1536 x 710
  against a throwaway database loaded with the C3 courses.

## 20. 3D examiner, Phosphor icons, spoken commands and reasoned plans (16 Oct 2026)

- Examiner: the 3D Avaturn sample avatar (non-commercial use, credited in the sign-in footer),
  animated by TalkingHead (MIT). Both load from jsDelivr at fixed versions (three 0.180.0,
  TalkingHead 1.7, avatar file at commit `2afe6d7`); `components/Examiner.tsx`. The question voice
  plays exactly as before (Slower, the voice meter and the time-to-first-word measure are unchanged);
  the avatar mouths the same words silently, spread over the clip's length. One avatar per page is
  moved between cards. A still portrait (`assets/examiner.png`, rendered from the same avatar) shows
  while it loads, on the sign-in and start pages, and wherever 3D cannot run. The drawn mascot was
  removed.
- Icons: Phosphor duotone (bold for small marks), MIT, copied as SVG into `components/icons.tsx`
  (no new package); the names match the old Lucide names. Font: Geist throughout; the student
  styles use one size scale (12, 13, 14, 15, 16, 18, 20, 24 px, with larger page headings).
- Spoken commands (policy `c04-policy-1.5-commands`): "Stop the viva", "End the viva", "I don't want
  to continue" end the viva; "Skip this question", "Next question" skip. They count only when said on
  their own (12 words or fewer), so an answer such as "the loop will stop when this is false" is
  marked as an answer. The rail lists the commands; tests cover both.
- Plans: the rules choose every study and speaking step from the evidence (missed points,
  misunderstandings, skipped questions, coverage, fillers per 100 words, time to first word, and the
  hedges, restarts or fluency signals that counted), and each step carries its reason ("Why: ...").
  Groq may only reword a step, keeping the same number and order; the reasons are never model-written.
- Smaller fixes: no course-code badges on topic cards; the topic search box has no browser autofill
  list; a spinner inside a button keeps the button's size; skipped questions read "Skipped" in the
  rail and the report; answer states read in plain words ("partly complete", "not an answer").
- Fix (16 Oct): the lips did not move because the voice signalled the start on the audio's `play`
  event, before the clip's length was known; it now signals on `playing`. The examiner is framed
  head to chest in a wider box, moves its hands while speaking (TalkingHead's own hand movement) and
  often adds an explaining index-finger gesture, alternating hands; thumbs and "OK" gestures are never
  used.

## 21. One voice, faster marking, spoken commands that are heard, a livelier examiner (16 Oct 2026)

- One voice: Groq's Orpheus voices drift between clips (diana's median pitch measured 140 to 166 Hz
  over four questions), which sounded like a different person per question. Every clip is now moved to
  one median pitch (`tts_pitch_hz`, default 160 Hz; `even_pitch()` in `app/integrations/speech.py`,
  Praat PSOLA, about 0.03 s a clip; 0 turns it off). Test: `test_every_voice_clip_gets_the_same_median_pitch`.
- Faster marking: `gpt-oss` models are asked to think briefly (`llm_reasoning_effort`, default "low").
  One marking call measured 3.0 to 3.5 s by default and 0.9 to 1.6 s on "low", with the same answer
  state. Set `VIVA_LLM_REASONING_EFFORT=medium` to go back. The database (Neon, us-east-2) adds about
  0.3 s a round trip from Sri Lanka; a viva answer makes four.
- Spoken commands: "viva" is often misheard, so the stop command also accepts diva, river, fever and
  similar (policy `c04-policy-1.6-misheard-viva`); Whisper's hint now mentions a viva (never whole
  commands, which Whisper can echo into a silent recording). Speech-to-text returns the `command` it
  heard; the page shows "Heard 'Stop the viva'" and the button becomes "Finish viva" or "Skip question"
  until the words are edited.
- Student view: "What we heard" (pauses and fillers) is no longer shown; the measures are still saved.
  The voice commands are a row of chips beside "Your answer", so the rail always has room for the
  questions; Save & leave and Finish sit side by side.
- Examiner: the lips follow the clip's real pauses (words are laid over the stretches that have sound,
  measured in the browser from the clip); she keeps eye contact, smiles softly while the student
  answers, makes a thinking face with a hand to the chin while an answer is marked, and gives the same
  small nod after every answer. Framed a little closer; the still portrait matches the framing.
