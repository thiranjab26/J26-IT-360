# C4 spec 3 of 3: viva feature (frontend)

How to build `frontend/src/features/viva` inside the shared app. Read with `frontend/README.md`,
`docs/architecture.md` section 6 and `frontend/src/features/tutor`, which is the working example.

## 1. Technology (must match the repo)

React 18, TypeScript, Vite, React Router 6, TanStack Query 5, Tailwind 4 (`@tailwindcss/vite`),
the `@/` path alias, pnpm workspace. All network calls go through `@/shared/api/client.ts`
(`request()`, base `/api`, which attaches the JWT and parses `ApiError`). Never call a service
port directly. Icons: add `lucide-react` to `frontend/package.json` only if the leader approves;
otherwise use inline SVG.

## 2. Folder layout

```text
frontend/src/features/viva/
├── api/vivaApi.ts            # types plus TanStack Query hooks over request('/viva/...')
├── pages/
│   ├── VivaSetupPage.tsx     # /viva
│   ├── LiveVivaPage.tsx      # /viva/sessions/:sessionId
│   └── VivaReportPage.tsx    # /viva/sessions/:sessionId/report
├── components/  Mascot.tsx  ConceptResult.tsx  SignalTable.tsx  CoverageRing.tsx
├── hooks/useSpeech.ts        # recording, transcription, question voice
├── viva.css                  # only what Tailwind can't express (mascot animation keyframes)
├── routes.tsx                # export const vivaRoutes: RouteObject[]
└── index.ts                  # the only export surface: vivaRoutes and public types
```

Mount it with one line in `frontend/src/app/router.tsx` (`...vivaRoutes` inside `StudentLayout`).
That file is leader-owned, so mention it in the PR. Lecturer screens (question bank review, rating)
come later in the same feature folder under `pages/lecturer/`.

## 3. Screens and behaviour to recreate

### Setup (`VivaSetupPage`)

- Topic cards from `GET /viva/topics` (one card per concept with approved questions); a choice between Speak (default, recommended) and Type; a "Start viva" button.
- Three explanatory steps: "Hear the question", "Answer in your own words", "Get your report".
- A collapsible "Learning context from AdaptLearn" panel that shows C1, C2 and C3 values, with mock values clearly labelled.

### Live viva (`LiveVivaPage`)

- Start screen first ("Ready when you are", with a **Start the viva** button). It avoids audio playing the moment the page opens and gives the user gesture browsers need for audio.
- An illustrated human examiner (`Mascot`) with states: `idle` (breathing, blinking, glancing), `speaking` (irregular lip movement, brow emphasis), `listening` (raised brows, head tilt, sound waves), `thinking` (eyes up and aside, one brow raised, "..." dots), `nodding` (the same nod after every answer). It never reacts to correctness, to keep the viva neutral. Animations are disabled under `prefers-reduced-motion`.
- The question is shown large and read aloud: `POST /viva/speech/synthesize`, then a female browser voice as fallback (prefer names like Aria, Jenny, Zira, Samantha or Libby that contain "Natural" or "Online").
- Controls: **Listen again**, a large microphone toggle, **Skip question**, "Type instead". A status line ("Listening · 12s", "Turning your recording into text...", "Thinking about your answer...").
- Recording: mono, 64 kbps, stops automatically at 175 s. After transcription the editable transcript appears, with a note to fix mistakes before submitting. Keep the recording for a retry if transcription fails. One request ID per unchanged answer, so retries are idempotent.
- Latency sent to the server = speech onset within the recording (from pressing record), not time since the question audio ended.
- Header: concept chip, "Follow-up n of 2" or "Main question", progress bar, Save and leave, Finish session (with an inline confirm).
- A collapsible conversation history.

### Report (`VivaReportPage`)

- Outcome card: red for knowledge gap, amber for communication difficulty, grey for mixed, green "No gap identified: strong answers" when `strong_answers` is true. Plain-language meaning under the title.
- A separate rubric coverage card with a ring and the note "the share of expected points your answers covered; not a confidence score".
- Improvement plan (summary plus numbered steps) and review material.
- "What came through" and "Worth revisiting" tags.
- One card per concept with its result ("No gap identified" when `no_weakness`), coverage, state change and answer count, plus a **Why this result** disclosure: the rule explanation and a table of every hesitation signal (value, threshold, counted).
- "How you spoke": time to first word, pauses, total pause time and fillers per 100 words, marked as supporting information only.
- "About this report": limitations and the mastery-mismatch note.

## 4. Visual style

Soft indigo, pink and violet background glows on student pages, translucent white cards, indigo
accent, Tailwind utility classes first. Keep the copy plain, use no em dashes, give everything visible
keyboard focus, and support phone widths.

## 5. Acceptance

- `pnpm --filter frontend typecheck` passes, and the lint boundary rules hold (no imports from other features' internals).
- With the frontend, gateway, auth-service and viva-service running, a student can log in, run a spoken viva end to end, skip a question, say "stop the session", and read the report.
