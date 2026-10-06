# A0 preparation — C02 lead-time items

Material for the six 🧑 items in `TODO.md` §A0. Each section ends with what "done" looks like, so the TODO box can be ticked with a one-line note.

---

## 1. Ethics clearance status

No participant data is collected before clearance is granted (CLAUDE.md invariant 7, TODO Milestone B).

Questions to settle with the supervisor / ethics office:

1. Has the application been submitted? Reference number and expected decision date?
2. Does the approved wording cover **per-frame derived signals** (about a dozen scalars per frame: EAR, iris offset, head pose angles, brow and lip distances), or only "anonymised feature vectors"? ARCHITECTURE.md §9 relies on keeping per-frame signals. If the wording is narrower, either amend the application or store per-second vectors only.
3. Are online (remote) pilot sessions covered, or only in-person ones? TODO §D has an online pilot.
4. Withdrawal: how long after a session can a participant withdraw, and is deleting their `P0x` export file sufficient?
5. Incentive amount and how payment is recorded without storing names next to `P0x` codes.
6. Where must the consent forms (which carry names) be stored, and by whom? They must never sit next to the data exports.

**Done when:** clearance status, reference number and the exact data-storage wording are recorded in a note under the TODO item.

---

## 2. Dataset access requests — mEBAL2 and ADABase

Both need a signed licence or request form. Approval can take weeks, so submit now.

### What to write in the request

- Requester: student name, SLIIT, supervisor name and email (supervisor sign-off is often required for academic licences).
- Project: "AdaptLearn C02 — privacy-preserving, in-browser cognitive load estimation from webcam facial landmarks; final-year research project J26-IT-360."
- Intended use: offline extraction of facial landmarks and derived features (blink, gaze proxy, head pose, brow movement) for model pre-training and comparison. No redistribution; no images or video published; data stored on an encrypted local disk and deleted at project end.

### What to confirm once access arrives

| Check | mEBAL2 | ADABase |
|---|---|---|
| Contains frontal RGB face video (not only IR/NIR or depth)? | | |
| Frame rate and resolution | | |
| Labels: what exactly (blink, attention, load level, NASA-TLX)? Per frame, per segment, per session? | | |
| Number of subjects; can samples be grouped by subject (needed for LOSO)? | | |
| Task type close to e-learning / programming? | | |
| Licence: allowed to publish derived metrics and figures? Allowed to keep derived features after the project? | | |
| Any published baseline on it we can compare against (e.g. DeepFace-Attention for mEBAL2) — paper opened and checked? | | |

Note: mEBAL2 is reported to use NIR and RGB cameras. Check that the RGB stream is the one provided, since MediaPipe FaceMesh is trained on RGB.

**Done when:** both requests are submitted (date noted), and later the table above is filled per dataset.

---

## 3. Kaggle "E-Learning Cognitive Load Dataset" — inspection checklist

Download with your own Kaggle account into `data/` (gitignored). Do not commit any of it.

| Question | Answer | Consequence |
|---|---|---|
| File types present (`.mp4`/`.avi`, `.npy`/`.csv` of landmarks, or only `.csv` of tabular features)? | | Video or landmarks → can feed `scripts/landmarks-to-features.ts`. Tabular only → cannot pre-train this pipeline (ARCHITECTURE.md §12). |
| If tabular: which columns? Are any of them blink rate, gaze, head pose? How were they computed? | | Different computation = train/serve skew. Usable only as a separate classical-ML comparison, described as such. |
| Label column: what are the classes and how were they obtained (self-report, task design, physiological)? | | |
| Subject ID column present? | | Without it LOSO is impossible; any reported accuracy would be inflated. |
| Licence (CC-BY, CC0, unknown)? | | |
| Original source / paper cited on the page? Open it and check it exists. | | |

**Done when:** the table is filled and a one-line verdict ("usable for pre-training" / "comparison only" / "not usable") is noted under the TODO item.

---

## 4. Message to C01 / C03 / C04 owners (draft, paste as-is or edit)

> Hi all — C02 (cognitive load) here. I'm about to build the load-state event stream and want to agree the interface before I code it. Three questions and one contract issue.
>
> **1. Where does your component consume the signal?**
> (a) in the same browser page (I give you a JS/TS emitter: `sensor.on('state', e => …)`),
> (b) in another tab / iframe (`BroadcastChannel('adaptlearn.load-state')`), or
> (c) on your server (your frontend code forwards the event; only the small JSON object crosses the network, never video).
>
> **2. Proposed event (proposal Appendix D, plus additive fields):**
> ```json
> {
>   "load_state": "High",            // "Low" | "Medium" | "High" | null
>   "confidence": 0.84,              // 0..1 | null
>   "frustration": true,             // boolean | null
>   "engagement": "Low",             // "Low" | "Medium" | "High" | null
>   "timestamp": "2026-10-15T14:30:00Z",   // ISO 8601 UTC
>   "schema_version": 1,
>   "status": "active",              // disabled | permission_denied | unsupported | calibrating | active | no_face | paused
>   "meta": { "fps": 15, "backend": "webgl", "model_version": "heuristic-0" }
> }
> ```
> Emitted on every state change and as a heartbeat every 5 s.
>
> **3. `null` is a normal state, not an error.** Sensing is opt-in and off by default; in our survey 45.8 % of students were not comfortable with webcam sensing. Please decide what your component does when `load_state` is `null` (e.g. C03: default difficulty; C01: ignore load in sequencing).
>
> **Contract issue:** `contracts/schemas/load-signal.schema.json` (draft v0) differs from the proposal:
> - enum `low/moderate/high` vs proposal `Low/Medium/High`;
> - requires `session_id` and `user_id` (fine for the server push — the browser knows both);
> - no `frustration` / `engagement`, and `additionalProperties: false` rejects them;
> - no `null` allowed for `load_state`.
>
> Proposal: I open a PR to `contracts/` that aligns the schema with the event above (keeping `session_id`/`user_id` for the C3 push). C3, does `POST /internal/load` get called by the browser via the gateway, or by load-service? Please reply by **[date]** so I can build to it.

**Done when:** each owner has answered question 1, the `null` behaviour is agreed, and the contract PR is opened (link noted under the TODO item).

---

## 5. Label definition — brief for the supervisor

**Decision needed:** what is the ground-truth class of a 30 s window in the pilot study?

| | (a) Designed difficulty | (b) Per-participant NASA-TLX terciles |
|---|---|---|
| Class of a window | Easy / Medium / Hard task block it came from → Low / Medium / High | Rank the participant's three task TLX scores; lowest → Low, etc. |
| Role of NASA-TLX | Manipulation check: confirm TLX rises with designed difficulty | The label itself |
| Class balance | Balanced by design | Balanced by construction, but… |
| Weakness | If a participant found "Medium" hardest, the label is wrong for them | With 3 blocks per person, terciles always produce exactly one of each class — identical to (a) whenever TLX ordering matches difficulty, and a reshuffle otherwise. Adds noise from a single questionnaire. |
| Defensibility at viva | Standard in cognitive load studies; easy to explain | Harder to justify with only 3 scores per person |

**Recommendation: (a)**, with TLX reported as a manipulation check (e.g. a repeated-measures test of TLX across difficulty levels). Report in the limitations which participants' TLX ordering disagreed with designed difficulty, and optionally re-run the evaluation excluding them as a sensitivity analysis.

Both options need: counterbalanced block order (Latin square), blocks ≥ 5 min, and windows inheriting their block's label (weak labels). See ARCHITECTURE.md §12.

**Done when:** the supervisor's choice and the date are recorded under the TODO item and in ARCHITECTURE.md §12.

---

## 6. Benchmark laptop

NFR1 says "mid-range laptop". Benchmark on the **weakest** laptop available so the number is conservative. Record each candidate below and pick the weakest one that is still a realistic student laptop.

| Field | Candidate 1 (developer laptop, auto-collected 2026-10-06) | Candidate 2 |
|---|---|---|
| Model | ASUS Vivobook X1502ZA | |
| CPU | Intel Core i5-1240P (12 cores / 16 threads) | |
| GPU | Intel Iris Xe (integrated), driver 32.0.101.7088 | |
| RAM | 16 GB | |
| OS | Windows 11 Home 10.0.26200 | |
| Webcam | USB2.0 HD UVC WebCam (built-in) | |
| Power mode during bench | (set and record: plugged in, "Balanced") | |
| Browsers + versions | (fill at bench time) | |

Integrated graphics only, so this is a reasonable "mid-range" reference. If a teammate has an older dual-core or 8 GB machine, that is the better weak-device candidate.

**Done when:** the chosen laptop is marked and its spec is copied into `docs/bench/devices.md` (created with the first bench run, A7).
