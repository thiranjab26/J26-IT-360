# AdaptLearn C04, Intelligent Viva System: LLM Continuation Handover

Prepared: 5 October 2026. Student: R. J. Vanderheyden, IT23212022. Project: J26-IT-360.

## Read this first

This file transfers the research proposal, relevant development conversation, and the saved prototype's actual implementation context to another LLM. **Continue the existing project; do not replace it with a generic AI interview chatbot.**

The user asked for the PDF to be preserved exactly and for later demo decisions to be included separately. Accordingly:

- **Part I is a handover summary and implementation context**, not a quotation from the PDF.
- **Part II preserves all 43 PDF pages' extractable text**, in page order, in verbatim text blocks. Original wording, spelling, figures in tables, citations, and printed page numbers are retained. Text blocks preserve the layout of extracted tables rather than rewriting their cells.
- **Part III transcribes image-only content**: the declaration, architecture figures, WBS, Gantt chart, and survey charts. These are explicitly marked visual transcriptions, not original PDF text-layer content.
- Markdown does not reproduce the PDF's typography, precise page layout, handwritten signatures, or original diagram pixels. Some PDF table columns overlap in extraction; consult the original PDF for exact visual layout. This file preserves wording and records visual content, rather than claiming a pixel-identical conversion.
- The source is a **proposal**, not evidence that the research has already been completed or validated. Proposed benefits, planned participants, and success criteria are not measured results.

### Source precedence

1. For what the submitted research proposal says, use `IT23212022 (2).pdf` and Part II/III of this file.
2. For implementation preferences made after the proposal, use explicit later user choices, marked below.
3. For the saved demo's behavior, use the inspected `adaptlearn-c4.zip` source snapshot. The user's current local copy may contain later edits and must be inspected before changing it.
4. Earlier assistant suggestions and verification reports are historical context, not proof of a current running configuration.

Do not silently revise the proposal to match the demo, or claim the demo implements a feature merely because the proposal requires it. If they differ, state the difference.

### Project boundary

The earlier visible conversation contains an unrelated AWS **Tomorrow Day** coursework project involving VPCs, EC2, RDS, CloudFront, and CloudFormation. It is not the architecture of this research project. Do not import that assignment's infrastructure, diagrams, test cases, company requirements, YAML settings, or viva-preparation questions into AdaptLearn C04.

The relevant research-development material was also recovered from the saved October 2 build brief, the saved demo archive, and the October 2–3 conversation context. These sources are identified below.

## 1. Research identity and purpose

| Field | Value from the proposal |
| --- | --- |
| Overall project | AdaptLearn – A Personalized Learning Intelligence Platform for Higher Education |
| Individual component | Intelligent Viva System, C04 |
| Project ID | J26-IT-360 |
| Student | R. J. Vanderheyden – IT23212022 |
| Institution | Sri Lanka Institute of Information Technology |
| Programme | B.Sc. (Hons) Degree in Information Technology, Specialized in Information Technology |
| Document | Project Proposal Report, September 2026 |

The problem is that weak oral performance can have different causes: the learner may lack knowledge, or may understand the subject but struggle to explain it. A correct/incorrect score alone does not reliably distinguish these situations.

C04 investigates a **constrained adaptive viva** that combines rubric-based answer evidence, structured follow-up responses, and supplementary hesitation observations. The contribution is the combined assessment and gap-differentiation approach, not simply adding an LLM to a voice chatbot.

### Core research commitments

- Use a structured concept-linked question bank: main question, reference answer, rubric points, known misconceptions, and follow-up pathways.
- Classify answers into exactly six states: **Complete, Partial, Superficial, Incorrect, Misconception-bearing, Non-answer**.
- A deterministic policy chooses the next questioning action using answer state, depth, and previous responses.
- AI may interpret an answer and naturally phrase/rephrase a policy-selected question. It must not freely control the assessment path.
- Observe pauses, response latency, fillers, hedging, and answer restarts as **supplementary evidence only**.
- Do not equate hesitation, accent, pronunciation, or voice quality with low knowledge, low confidence, or a psychological diagnosis.
- Produce **Likely Knowledge Gap**, **Likely Communication Difficulty**, or **Mixed/Insufficient Evidence**. Do not force a conclusion when evidence is unclear.
- Provide relevant learning review recommendations for a likely knowledge gap and communication/explainability guidance where appropriate.
- Produce a post-viva report and maintain evidence for human evaluation.

## 2. Architecture and component ownership

| Component | Responsibility | Relationship with C04 |
| --- | --- | --- |
| C01, Adaptive Curriculum Engine | Learner mastery and learning topics | Sends topic/mastery information; receives a review notification/recommendation when appropriate. C04 must not directly overwrite C01 mastery. |
| C02, Cognitive Load Detection | Learner load, frustration, engagement | Context may adjust timing, prompting, and session length. It is not a direct knowledge-gap diagnosis. |
| C03, AI Tutoring and Explanation | Course-grounded explanation and learning support | Supplies course material for questions/rubrics and review resources. Later demo agreement assigns course-material/vector-database ownership to C03. |
| C04, Intelligent Viva System | Question bank, assessment, six states, deterministic follow-ups, hesitation, gap differentiation, feedback, evaluation | User's individual implementation. Other components are integrations, not additional full systems to build. |

The PDF specifies REST APIs and JSON exchanges. Later build discussions sometimes call C02 “Cognitive Tracker” and C03 “Gamified AI Tutor.” Preserve the PDF's component names when discussing the report; those later labels do not change the ownership boundary.

### Intended session flow

1. Select a concept/topic manually or using C01 context.
2. Select an approved structured question; speak/display it.
3. Capture a spoken answer or typed fallback. Transcribe speech.
4. Compare answer content with the reference answer and rubric.
5. Assign one of the six states.
6. Deterministic policy selects a follow-up action or ends the concept. Optional AI wording stays inside that selected purpose.
7. Repeat within depth/history limits. Gather hesitation observations alongside content evidence.
8. Combine initial answer, follow-up evidence, and supplementary hesitation into a conservative gap outcome.
9. Generate feedback, communication guidance or review materials, and the report. Notify C01 where appropriate without changing mastery directly.

Question-bank generation/approval is preparation before live assessment; it is not permission for an LLM to improvise the live assessment policy.

## 3. Research study and requirements to preserve

The proposal uses **Design Science Research with controlled quantitative evaluation** and iterative prototyping.

- Approximately **20–30 IT/Computer Science undergraduates**, subject to ethical approval and availability.
- A small set of computing concepts, such as DSA, OOP, or databases.
- A pre-viva written knowledge check; recorded answers, follow-ups, classifications, and hesitation evidence; possibly a short post-viva self-report.
- **Two independent human raters** with suitable computing knowledge, blinded to the system's final decisions.
- Expert review of questions, reference answers, rubrics, misconceptions, and follow-up pathways before the main evaluation.
- Pilot/refinement before the main dataset; anonymised participant data.
- Public speech data may help develop speech features but does not replace the primary viva dataset.

| Condition | Evidence in the PDF |
| --- | --- |
| A, Baseline | Initial answer content only |
| B, Adaptive Viva | Initial answer + structured follow-up responses |
| C, Proposed Full Approach | Initial answer + structured follow-up responses + response-hesitation indicators |

The same recorded participant data can support all three conditions. Human judgement is the **reference standard**, not the baseline. Metrics: accuracy, macro F1, Cohen's kappa, follow-up appropriateness, and feedback usefulness. Improvement in B/C is a research question, not an established result.

Earlier draft suggestions about voice-only/transcript-only/self-report-only/fused comparisons must not replace the latest PDF's A/B/C design.

### Requirements index, summary, not verbatim

| IDs | Obligation |
| --- | --- |
| FR01–FR02 | Topic selection and structured question delivery |
| FR03 | Speech response capture plus a text option |
| FR04–FR05 | Reference/rubric assessment and six answer states |
| FR06 | State-based suitable follow-ups |
| FR07–FR08 | Hesitation analysis and combined gap differentiation |
| FR09–FR10 | Post-viva summary, guidance, and relevant review materials |
| FR11 | AdaptLearn integration |
| NFR01 | Approximately 5 seconds to present the next question after response processing |
| NFR02–NFR03 | Authorized access and anonymised research data |
| NFR04–NFR05 | Simple interface and saved response/session progress |
| NFR06–NFR07 | Typed accessibility fallback and isolated independent sessions |

The full original requirement wording is in Part II, printed pages 28–29. These targets are not all proven by the existence of a demo.

## 4. Later user decisions and development conversation

This section is **later context**, separate from the September proposal.

| Item | Preserved context | Status |
| --- | --- | --- |
| Database | User chose an existing **Neon PostgreSQL** database and said they would connect it. | Explicit user choice; successful connection in the user's latest environment is not confirmed here. |
| LLM | User obtained a **Gemini API key**, preferring it over installing Ollama because of storage limits. | Explicit user choice; successful live Gemini calls are not established by the saved archive. |
| Hardware at that time | 16 GB RAM, GTX 1650 with 4 GB VRAM, approximately 18 GB storage free. | User-reported October 3 constraint; do not prescribe large local model downloads by default. |
| Cost | Free-first implementation; no required paid API to start. | Preserve this preference. Do not promise permanent unlimited free provider access. |
| Model training | Use pretrained models and deterministic logic initially; no custom model training required to build the prototype. | Prior build direction. Participant collection is for evaluation, not proof of a trained classifier. |
| C03 ownership | Course materials and vector retrieval belong to C03. C04 consumes retrieval/context through an API. | Preserved development boundary. No C04 lecture-PDF upload screen was required by the final build brief. |
| Other components | Mock C01/C02/C03 first, replace adapters with teammate APIs later. | Implemented mock-first structure in archive. |
| Follow-up usability | User tried the demo and found follow-up questions confusing, asking whether this was because no LLM was connected. | Open concern; no subsequent completed fix was recovered. |
| Speech and hesitation | User asked what transcribes speech, what detects hesitations, and whether it is implemented. | Optional speech and hesitation code exists; see actual limits below. |
| Materials and rubrics | User asked where mock course material is added and where/how rubrics are created. | File locations and editing approach are documented below. |

An older conversation mistakenly interpreted “Astra” as DataStax Astra DB. That is **superseded**: the later build brief uses Neon, and Astra referred to the model/build request. Do not switch the project back to Astra DB because of that older suggestion.

## 5. Saved demo snapshot, inspected source, not assumed live status

The saved `adaptlearn-c4.zip` dated 2 October 2026 was opened and inspected while preparing this handover. This is stronger evidence of that snapshot's implementation than an earlier plan, but is not evidence that the user's current local checkout is identical.

### Source map

All paths below are relative to the archive's `adaptlearn-c4/` root; they are portable project paths, not guaranteed paths on the next machine.

| Path | Purpose |
| --- | --- |
| `README.md` | Local launch, Neon/LLM/speech configuration, workflows, and limits |
| `docs/implementation-contract.md` | API shapes and component contracts |
| `docs/VERIFICATION.md` | Historical test results and explicitly untested services |
| `backend/services/viva-service/app/config.py` | Environment settings and defaults |
| `backend/services/viva-service/app/database.py` | SQLAlchemy models and database setup |
| `backend/services/viva-service/app/main.py` | FastAPI routes and session workflow |
| `backend/services/viva-service/app/providers.py` | Demo assessor and real LLM assessment/generation abstraction |
| `backend/services/viva-service/app/logic.py` | Deterministic policy, hesitation text features, gap rules, reports |
| `backend/services/viva-service/app/integrations.py` | `TOPICS`, hardcoded `MATERIAL`, mock context, real HTTP adapters |
| `backend/services/viva-service/app/seed.py` | Demo questions, rubrics, misconceptions, follow-up templates, knowledge checks |
| `backend/services/viva-service/app/speech.py` | Optional faster-whisper transcription and Silero pause detection |
| `backend/services/viva-service/app/semantic.py` | Optional embedding similarity helper; not part of the scored assessment/gap path |
| `backend/services/viva-service/app/research.py` | Blinded cases and condition-specific evaluation metrics |
| `backend/services/viva-service/app/notifications.py` | C01 review-notification delivery handling |
| `features/viva/` | React/TypeScript/Tailwind feature, workspace, staff screens, reports, speech hook |
| `src/main.tsx`, root Vite files | Standalone frontend host |
| `scripts/setup.py`, `scripts/run.py` | Dependency setup and local launch |
| `backend/services/viva-service/tests/` | Backend test suite |

### What is present and what is still configuration/proposal

| Capability | Source snapshot status |
| --- | --- |
| Text viva/session history/report | Implemented routes and UI with persisted sessions and results |
| Persistence | SQLAlchemy; default local SQLite. Neon supported through `DATABASE_URL`; connecting it is separate configuration. |
| Assessment | Default `demo` is lexical phrase/rubric matching, not a real LLM. LLM provider code for Ollama and an OpenAI-compatible endpoint is present. |
| Generated bank | Demo templates or configured LLM generation; review/edit/approve/reject workflow exists. Demo content is not proof of lecturer review. |
| Rubric editing | Staff UI edits rubric and misconception structures using JSON fields; question text and follow-up fields can be edited. A more guided rubric editor was discussed, not established as delivered. |
| Follow-up action | Deterministic Python state/depth/history policy is implemented. |
| Follow-up wording | Selects stored state-specific templates, with fixed alternate/simplification wording. There is no live LLM rephrasing call in `next_question()`. Connecting Gemini alone does not add this feature. |
| Question targeting | `PROBE_MISSING_RUBRIC` is an action name, but this snapshot selects the stored `partial` template; it does not dynamically construct a question for the particular missing rubric item. This helps explain the user's confusing-follow-up concern. |
| Speech synthesis/capture | Browser speech synthesis and microphone workflow are included. |
| Speech recognition | Optional faster-whisper local implementation. `SPEECH_PROVIDER=disabled` by default. Dependencies, model download, and real microphone inference must be verified. |
| Pause detection | Silero VAD via faster-whisper; internal speech gaps of at least 400 ms, excluding leading/trailing silence. |
| Other hesitation | Regex counts for fillers, hedges, and restart phrases; fillers per 100 words. Spoken latency comes from client timing and is an estimate. No acoustic timings invented from typed text. |
| Gap/report | Deterministic conservative rules and reports are implemented; thresholds are prototype hypotheses, not validated scientific findings. |
| C01/C02/C03 | Mock context plus configurable HTTP adapters. C03 `MATERIAL` is hardcoded sample content, not a real vector search. |
| C01 mastery | Not modified. Review events can be locally recorded/mocked or sent to a configured review endpoint. |
| C01 starting depth | Context contains starting difficulty, but the inspected session selection chooses stable approved questions per concept; do not claim mastery-adaptive starting depth is fully implemented. |
| C02 | High cognitive load can reduce maximum follow-up depth to one; it is not fed into the gap classifier. |
| Human evaluation | Blinded cases/ratings and metric functions exist. Existence of a dashboard is not a completed participant study. |
| Raw model audit | Validated assessments, provider information, actions, selected follow-ups and policy/model versions are stored. The full unmodified raw LLM response is not separately persisted by the inspected assessment path. |

### Existing question bank and data model

Demo topics: `stacks`, `queues`, `oop`, `databases`. `app/integrations.py` contains mock course text and review resources. `app/seed.py` contains curated sample questions, reference answers, rubric points and their matching keywords, misconceptions, and stored follow-ups. The admin workflow can generate drafts from retrieved C03 chunks and approve content before live selection. Existing sessions take snapshots so later edits do not rewrite their original assessment content.

Actual SQLAlchemy tables: `users`, `auth_tokens`, `generated_question_bank`, `viva_sessions`, `viva_turns`, `viva_results`, `integration_events`, `knowledge_checks`, `human_ratings`.

The API base is `/api/v1`. Core route groups cover authentication, topics, integrations, knowledge checks, sessions/answers/reports/exports, speech transcription, bank management, and evaluation. Use `docs/implementation-contract.md` and actual source for complete schemas rather than inventing new incompatible endpoints.

### Deterministic follow-up behavior in this snapshot

| State/condition | Selected action |
| --- | --- |
| Complete | `NEXT_CONCEPT` |
| Non-complete at maximum depth | `DEPTH_LIMIT_NEXT_CONCEPT` |
| Partial | `PROBE_MISSING_RUBRIC` |
| Superficial | `ASK_REASONING_OR_EXAMPLE` |
| Misconception-bearing | `PROBE_MISCONCEPTION` |
| Incorrect | `ASK_SIMPLER_OR_PREREQUISITE` |
| First non-answer | `REPHRASE` |
| Non-answer after an earlier non-answer | `SIMPLIFY` |
| Repeated stored prompt | Try a fixed different-example prompt, then advance if that also repeats |

Do not confuse these state-to-action rules with LLM-generated questions. Improvements should preserve the deterministic choice and make the selected prompt more relevant to the missing evidence.

### Gap rules worth knowing before continuing

These are **implementation details**, not verbatim PDF requirements:

- A uses the first response only. The present conservative engine returns Mixed/Insufficient for one answer, including when the initial answer is complete; in the latter case the explanation says there is no weakness requiring attribution.
- Persistent misconceptions across two substantive responses, or repeatedly low coverage below 50%, can support a likely knowledge gap unless contradicted by a strong written check.
- A strong written check is currently at least 80%. Demo checks have only two items and are weak corroboration.
- Communication difficulty requires an initially weak **spoken** answer, recovery to complete coverage, a strong written check, and no potentially teaching/scaffolding follow-up. Repeated non-teaching recovery can support B; supplementary initial hesitation can support C after one recovery probe.
- High-hesitation prototype triggers include latency at least 3,000 ms, total pauses at least 2,500 ms, fillers at least 8 per 100 words, or at least 2 restart phrases. These thresholds need validation and should not be described as clinically meaningful.
- The final session outcome is Knowledge only if all concept outcomes are Knowledge; Communication only if all are Communication; otherwise Mixed. Read concept explanations rather than interpreting every Mixed result as failure.
- The research UI keeps the written-check evidence constant across A/B/C. The proposal describes A as initial answer only; document this additional constant evidence explicitly in any final experimental protocol rather than silently changing the PDF wording.
- Since current A always produces Mixed at the gap level, review baseline adequacy before a formal study. This is an identified implementation limitation, not a revision to the research proposal and not a task already completed.

### Speech limits

The archive uses local `faster_whisper`, default `WHISPER_MODEL=base.en`, `WHISPER_DEVICE=cpu`, and int8 compute. Audio is decoded to 16 kHz mono, limited to three minutes in the decoder, and the configuration limits upload size to 20 MiB. The endpoint processes audio in memory and does not retain it.

Pause observations are computed from VAD, not merely guessed from punctuation. Transcription can omit fillers; the regex counts therefore do not guarantee complete disfluency detection. The transcription response returns segment timestamps and speech intervals; although word timestamps are requested internally, the response does not expose a full word-timing list. Microphone permission/start delay can affect the estimated response latency.

Do not claim hesitation analysis has been scientifically validated or that a typed demo proves the spoken pipeline works.

## 6. Run and configure the existing project

These instructions describe the archived project. Inspect the user's current checkout before applying them. No keys or database credentials are included in this handover.

From `adaptlearn-c4/`:

```bash
python scripts/setup.py
python scripts/run.py
```

Use `python3` where appropriate. The archive README specifies Python 3.11+ and Node.js 22.12+ or a supported newer LTS. Local frontend: `http://127.0.0.1:5173`; API docs: `http://127.0.0.1:8000/docs`.

Backend configuration file: `backend/services/viva-service/.env`, based on `.env.example`.

### Neon, explicit user choice

```dotenv
DATABASE_URL=postgresql+psycopg://YOUR_USER:YOUR_PASSWORD@YOUR_HOST/YOUR_DATABASE?sslmode=require
```

This is a placeholder. Preserve the connection settings supplied by the user's Neon project. Switching the database URL does not migrate existing SQLite sessions. Neon stores data; it does not perform LLM assessment or speech transcription.

### Gemini, historical suggested configuration, not a completed live test

The October 3 conversation suggested using the archive's OpenAI-compatible provider:

```dotenv
ASSESSMENT_PROVIDER=openai
GENERATION_PROVIDER=openai
LLM_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai
LLM_MODEL=YOUR_GEMINI_MODEL_ID
LLM_API_KEY=YOUR_BACKEND_ONLY_KEY
ALLOW_CLOUD_LLM=true
DEMO_FALLBACK=false
```

`openai` here identifies the compatible request format in the code, not a requirement to use an OpenAI account. The client appends `/chat/completions`. Model availability and JSON-schema compatibility must be checked against the chosen Gemini model when configuring it; no current provider compatibility claim or working model ID is established here. Keep credentials on the backend. Do not put keys into `VITE_*` values, frontend code, a report, or this handover.

The cloud provider interprets answers/generates draft bank entries; Python still chooses follow-up actions and gap outcomes. There is no evidence that the suggested configuration was actually applied successfully after the archive was generated.

### Optional local speech

```bash
python scripts/setup.py --speech
```

```dotenv
SPEECH_PROVIDER=faster_whisper
WHISPER_MODEL=base.en
WHISPER_DEVICE=cpu
```

Restart after configuration changes. Initial model download needs storage/network access. Keep typed fallback. This does not require running a large local chat model.

### Teammate APIs

Relevant settings: `C01_API_URL`, `C02_API_URL`, `C03_API_URL`, `C01_REVIEW_URL`, `INTEGRATION_API_TOKEN`, `INTEGRATION_TIMEOUT_SECONDS`.

The archive uses GET for C01/C02 context with topic/participant parameters and POST for C03 retrieval with topic/course/student context. Match the agreed teammate contracts. An empty component URL yields a clearly labelled mock; a failing configured adapter should not silently substitute mock evidence.

## 7. What was previously tested

`docs/VERIFICATION.md` records tests performed **2 October 2026** on Linux, Python 3.12 and Node.js 24:

- 25 backend tests; TypeScript/Vite build.
- Typed viva over HTTP, report persistence, replay/ownership behavior.
- Browser registration, viva, report/history, question generation/approval, and independent rating submission.
- Desktop/mobile inspection, evaluator access boundaries.
- Audio decoding, actual Silero silence detection, and internal-pause calculations.
- C01 delivery success/failure persistence with controlled HTTP responses.

That document explicitly says **Neon, real LLM inference, actual microphone/Whisper transcription, real C01–C03 services, other operating systems, production deployment, and scientific validity were not live-validated**. These historical tests were not rerun to produce this Markdown file. This handover's verification consisted of reading the PDF, inspecting its visual content, and inspecting the saved source snapshot.

## 8. Continuation priorities and unresolved work

These are next-step recommendations based on the existing context, not completed changes:

1. Obtain/open the user's **current source checkout** and compare it with `adaptlearn-c4.zip`. Preserve any later user edits; do not overwrite it with the old archive.
2. Confirm the current database/provider/speech settings without exposing secrets. The user has already chosen Neon and Gemini; do not re-open that choice unnecessarily.
3. Verify a real Gemini assessment and generation request with valid schema output. Ensure the UI/provider provenance distinguishes demo from real inference and failures do not silently become claimed LLM results.
4. Address the confusing follow-ups: map missing rubric evidence and misconceptions to suitable non-leading prompts; retain deterministic actions/history/depth control. Optional LLM phrasing must be constrained to the selected purpose. Merely changing the provider does not change `next_question()`.
5. Verify the actual microphone → local transcription → transcript review → pause/disfluency metrics → saved turn flow. Distinguish unavailable measurements from zero hesitation.
6. Demonstrate how mock course text and seeded rubrics work, and how staff can review/edit/approve bank items. Integrate C03 retrieval later; do not quietly make C04 own C03's vector database or lecture uploads.
7. Review research fidelity before participant evaluation: baseline behavior, use of the written check, fair A/B/C evidence exposure, independent raters, expert-approved content, and auditable model/policy versions. Do not tune final-study thresholds using held-out evaluation labels.
8. Preserve privacy, typed accessibility, session ownership/progress, and clear mock labels while moving from demo to integrated system.

Do not invent completion of ethics approval, lecturer approval, participant collection, accuracy improvements, live integration, deployment, or paid subscriptions.

## 9. Known source differences, preserve, do not silently repair

| Difference | How the next LLM should handle it |
| --- | --- |
| PDF allows generic free hosted database/tools; later user chooses Neon/FastAPI/React/Gemini | Describe these as later implementation decisions, not PDF quotations. |
| PDF permits AI phrasing of policy-selected follow-ups; archive uses stored/fixed prompts | Keep this feature gap explicit. |
| PDF research plan versus demo thresholds/data | Prototype rules, hardcoded materials, two-item checks, and sample bank approval flags are not validated research evidence. |
| Budget table optional API row says LKR 5,000–10,000; following prose says LKR 5,000–15,000 | Both are preserved in the source transcript; do not silently choose one. |
| Budget table's Answer Assessment/AI item says “Web Speech Synthesis API” | Preserve source wording. Do not infer that browser TTS is the actual answer assessor. |
| Survey chart denominators/count totals differ | Preserve the displayed results. Do not invent missing raw responses or normalize them into a single-choice dataset. |
| Some source typos, duplicate sentences, table numbering, and overlapping labels | Preserve source text; any correction requires a separate requested edit. |

## 10. Prompt for the receiving LLM

> Continue my AdaptLearn C04 Intelligent Viva System from this handover. Read Part I first, then use the complete proposal in Part II and the image transcriptions in Part III as the research source. Keep proposal requirements, later decisions, inspected prototype behavior, and unverified claims separate. My chosen database is Neon PostgreSQL and my later LLM choice is Gemini. C04 owns the viva; C01–C03 are integrations, with C03 owning course material/vector retrieval. Preserve deterministic follow-up selection, six answer states, three conservative gap outcomes, supplementary-only hesitation, and A/B/C human-rater evaluation. Inspect my current source before editing; the saved October 2 archive may be older. Continue from my next request without restarting the design or claiming untested services are working. If code is needed and you do not have it, ask me for the current project archive or repository, rather than fabricating paths or implementation details.

### Source inventory

- Authoritative PDF: `IT23212022 (2).pdf`, 43 physical pages, title page plus printed pages 1–42. PDF SHA-256: `cfd0e64ba1e151dc581113b78742b45d3b4445f9a535abc147f56337f7eb2868`.
- October 2 final build brief: `Pasted text(3).txt`; a specification, not proof of implementation.
- Earlier stack discussion: `Pasted markdown.md`; includes superseded Astra DB/SQLite suggestions and earlier assistant advice.
- Saved source: `adaptlearn-c4.zip`, SHA-256 `503613605d1d589a5c70a5bd0e4bf01b9ea5e01cfcaeca6e4a51c5cc500d9f70`; source and its README/verification/contracts inspected.
- Retrieved October 2–3 conversation: explicit Neon/Gemini/hardware preferences, user follow-up confusion, questions about materials/rubrics and hesitation; prior assistant reports marked as historical above.
- No live database/API credentials, private keys, or participant data are included.

This Markdown contains the research text and continuation context, **not the project source code**. To modify or run the demo, the receiving LLM needs the actual project files as well.

---

# Part II, Complete source PDF text, page by page

The text blocks below are the original `pdftotext -layout` output for each physical PDF page, apart from removing outer blank whitespace and the form-feed page separators. No wording or numeric claims have been corrected. Physical PDF page 1 is the cover; physical PDF page 2 is printed page 1, and so on. Image-only content is transcribed separately in Part III.


## Source PDF page 01, Cover (no printed page number)

```text
Project Title: AdaptLearn – A Personalized Learning Intelligence

                 Platform for Higher Education


                     Intelligent Viva System


                     Project ID: J26-IT-360


                     Project Proposal Report


                R. J. Vanderheyden – IT23212022


  B.Sc. (Hons) Degree in Information Technology, Specialized in


                     Information Technology


                    Department of Computing


      Sri Lanka Institute of Information Technology Sri Lanka


                         September 2026
```


## Source PDF page 02, Printed page 1

```text
Declaration




              1
```


## Source PDF page 03, Printed page 2

```text
Abstract

Higher education learning platforms commonly use quizzes, assignments, and automated
assessments to estimate students' mastery. However, these measures do not always show whether
a student learner can explain and defend the knowledge in a live oral setting. The individual
research problem is that poor viva performance can be a result either from a genuine knowledge
gap or from a communication/confidence gap, where the student understands the subject but has
difficulty in expressing or explaining it verbally. Evidence supporting this problem includes the
use of answer correctness together with observable hesitation indicators such as pauses, filler
words, hedging language, response latency, answer restarts, and self-reported confidence to
identify uncertainty during spoken responses. The identified research gap is the lack of an
integrated adaptive oral assessment approach that combines content correctness, structured
follow-up questions, and response-hesitation evidence to distinguish knowledge gaps from
communication gaps. The proposed research contribution is a constrained adaptive viva system
that combines answer-state classification, deterministic follow-up question selection, response-
hesitation analysis, and diagnostic reasoning. The proposed product component, the Intelligent
Viva System, will conduct live spoken viva sessions, adapt questioning to students' viva
responses, diagnose the outcome, provide targeted communication/explainability improvement
guidance when appropriate, and generate a post-viva report. The research methodology will use
a Design Science Research Approach with quantitative, measurable results and human-rater
comparisons. The development approach will use iterative prototyping across question bank
preparation, answer classifications, follow-up questioning, response hesitation analysis, gap
differentiation, and integration. Within AdaptLearn, the component acts as a mastery verification
and assessment later using inputs from the curriculum Engine, Cognitive Load Detection, and AI
tutoring components

Keywords: Adaptive assessment, Communication Gap, Intelligent viva, Knowledge
Verification, Oral Assessment




                                                                                                2
```


## Source PDF page 04, Printed page 3

```text
Acknowledgement

I would like to express my sincere gratitude to my supervisor and co-supervisor for their
guidance, feedback, and support throughout the development of this research proposal. I also
thank the academic staff and the domain experts who contributed to the validation of the
AdaptLearn concept and its assessment.

I am especially thankful to the Department of Information Technology, SLIIT, for providing the
academic environment, resources, and support necessary to carry out this research

 My appreciation extends to my project team members for coordinating the interfaces among the
four research components. Finally, I thank my family, colleagues, and prospective student
participants whose perspectives are essential to developing a practical and responsive learning
system




                                                                                                 3
```


## Source PDF page 05, Printed page 4

```text
Table of Contents
Abstract ........................................................................................................................................... 2
Acknowledgement .......................................................................................................................... 3
List of tables.................................................................................................................................... 6
List of figures .................................................................................................................................. 7
List of Abbreviations ...................................................................................................................... 8
List of appendices ........................................................................................................................... 9
1. Introduction ............................................................................................................................... 10
   1.1 Background and Context ..................................................................................................... 10
   1.2 Literature Review ................................................................................................................ 13
   1.3 Research Gap ....................................................................................................................... 17
2. Objectives ................................................................................................................................. 18
   2.1 Main Objective .................................................................................................................... 18
   2.2 Specific Objectives .............................................................................................................. 18
3. Methodology ............................................................................................................................. 19
   3.1 Research Methodology / Research Design .......................................................................... 19
   3.2 Data/Participants/Experimental Inputs ................................................................................ 19
   3.3 Baseline/Benchmark ............................................................................................................ 20
   3.4 Evaluation Metrics .............................................................................................................. 21
   3.5 Validation Strategy .............................................................................................................. 22
   3.6 Development Approach ....................................................................................................... 22
4. High-level system architecture ................................................................................................. 23
   4.1 Overview of proposed solution and components ................................................................ 23
   4.2 Individual Component Architecture .................................................................................... 24
   4.3 Overall Integration .............................................................................................................. 26
   4.4 Individual Responsibility Boundary .................................................................................... 27
5. User Requirements .................................................................................................................... 28
   5.1 Requirements identification ................................................................................................ 28
6. Commercialization Plan ............................................................................................................ 30
   6.1 Target Market and Customer Persona ................................................................................. 30

                                                                                                                                                    4
```


## Source PDF page 06, Printed page 5

```text
6.2 Value proposition ............................................................................................................... 30
   6.3 Revenue Model.................................................................................................................... 30
   6.4 Pricing Strategy ................................................................................................................... 30
   6.5 Competitive Advantage ....................................................................................................... 31
   6.6 Intellectual Property Considerations ................................................................................... 31
7. Budget and Justification ............................................................................................................ 32
8. Work Breakdown Structure (WBS) .......................................................................................... 34
9. Gantt Chart ................................................................................................................................ 35
10. References List........................................................................................................................ 36
11. Appendices .............................................................................................................................. 38
   Appendix1- Student Requirements Survey ............................................................................... 38
   Appendix2 – Mandatory Proposal Evidence and Decision Log ............................................... 40
   Appendix3 – AI Use Disclosure ................................................................................................ 42




                                                                                                                                                5
```


## Source PDF page 07, Printed page 6

```text
List of tables

Table 1 Literature Review ............................................................................................................ 13

Table 2 Baseline/Benchmark table ............................................................................................... 20

Table 3 Integration table ............................................................................................................... 26

Table 4 Responsibility Table ........................................................................................................ 27

Table 5 Functional Requirements Table ...................................................................................... 28

Table 6 Non Functional Requirements Table ............................................................................... 29

Table 7 Budget Table .................................................................................................................... 32

Table 8 mandatory proposal evidence and log tables ................................................................... 41

Table 9 AI use disclosure table ..................................................................................................... 42




                                                                                                                                          6
```


## Source PDF page 08, Printed page 7

```text
List of figures

Figure 1 High-Level AdaptLearn System Architecture with C04 Highlighted ............................ 23

Figure 2 Intelligent Viva System Internal Architecture ................................................................ 25

Figure 3 Work Breakdown Structure ............................................................................................ 34

Figure 4 Gantt Chart ..................................................................................................................... 35




                                                                                                                                           7
```


## Source PDF page 09, Printed page 8

```text
List of Abbreviations

Abbreviation   Full Term
AI             Artificial Intelligence
API            Application Programming Interface
AUC            Area Under the Curve
C01            Adaptive Curriculum Engine
C02            Cognitive Load Detection
C03            AI Tutoring and Explanation
C04            Intelligent Viva System
CoEAI          Centre of Excellence for Artificial Intelligence
DSR            Design Science Research
FR             Functional Requirement
HEPI           Higher Education Policy Institute
IOA            Interactive Oral Assessment
IT             Information Technology
JSON           JavaScript Object Notation
LKR            Sri Lankan Rupee
LLM            Large Language Model
LMS            Learning Management System
NFR            Non-Functional Requirement
NLP            Natural Language Processing
REST           Representational State Transfer
SaaS           Software as a Service
SDG            Sustainable Development Goal
STT            Speech-to-Text
TTS            Text-to-Speech
WBS            Work Breakdown Structure




                                                                  8
```


## Source PDF page 10, Printed page 9

```text
List of appendices

appendix 1 Survey........................................................................................................................ 40
appendix 2 Mandatory proposal and Decision log ...................................................................... 40
appendix 3 AI usage disclosure ................................................................................................... 42




                                                                                                                                          9
```


## Source PDF page 11, Printed page 10

```text
1. Introduction

1.1 Background and Context

  Real-world problem

  The assessment of student performance in higher education has been increasingly conducted
  with the help of online quizzes, assignments, and automated assessment tools. These
  methods, however, are not always indicative of whether or not a learner is able to explain,
  justify, and defend the same knowledge during live questioning. Interactive oral assessments
  enable the examiner to explore the ideas and reasoning of students and to gauge whether they
  really understand what they have learned [1]. As AI, and particularly generative AI, has
  become more widely used, written work alone may no longer provide sufficient evidence of a
  student's independent understanding [2].

  The major issue for this research is that the reasons for poor viva performance may vary. A
  student may have a genuine lack of knowledge, or may understand the subject but find it
  difficult to put that knowledge into words. If the same feedback is given in both situations, it
  may result in inappropriate support.

  Previous research has also identified anxiety and nervousness as factors that can influence
  oral-assessment performance, indicating that weak oral performance may not always
  represent weak subject knowledge [15], [16].

  Who is affected and why it is important

  The primary users affected are undergraduate students who are expected to explain technical
  concepts, justify implementation decisions, defend project work, and participate in vivas and
  technical interviews. Lecturers and tutors are also affected, as assessment scores may not
  adequately demonstrate why a student is struggling.

  Having an awareness of whether the problem is due to a lack of knowledge or a
  communication difficulty can help guide appropriate feedback. It may be necessary to
  provide extra learning content for a knowledge gap, while extra oral practice and guidance
  may be more suitable for a communication difficulty. Interactive oral assessments have also
  been associated with the development of communication and professional skills, supporting
  the use of communication-improvement guidance following the viva [18].

  Statistical evidence



                                                                                                10
```


## Source PDF page 12, Printed page 11

```text
Generative AI has become commonplace in higher education. According to a survey by the
Higher Education Policy Institute (HEPI) conducted in the UK, 92% of the students surveyed
used some form of AI, while 88% had used generative AI for assessments in 2025 [3].

In addition to this international evidence, there is also strong local evidence of AI adoption.
A study conducted among final-year students in the SLIIT Faculty of Computing revealed
that 99% of respondents were using AI tools for academic purposes and 94% used ChatGPT
[4]. These findings show that AI-assisted learning is already highly relevant within the Sri
Lankan higher-education context and further support the need for assessment approaches that
can directly verify students' understanding.

Existing solutions and their limitations

Common LMS platforms such as Blackboard, Canvas, and Moodle mainly provide content
delivery, quizzes, assignments, and grade management. However, they do not provide
structured adaptive oral verification of a student's recorded mastery.

Human-led vivas provide opportunities to probe the depth of student understanding, while
research also shows that the validity and reliability of oral assessment depend on careful
structure, clear rubrics, and consistent implementation [12], [14]. Previous research has also
shown that oral examinations can be implemented in online environments, although careful
design is required to maintain validity, reliability, and fairness [17].While general-purpose AI
assistants can engage in conversation, freely generated follow-up questioning can be difficult
to control, compare, and evaluate consistently.

Additional information, such as speech-related features, can also be useful. Research has
shown that vocal characteristics can vary under different levels of mental effort [5].
However, these signals should not be treated as direct evidence of confidence or knowledge.
Therefore, the proposed system will use response-hesitation indicators only as supplementary
evidence.

Proposed solution and its main parts

The present research proposes an Intelligent Viva System that will conduct structured
technical vivas and adapt follow-up questioning based on the student's answers.

The core of the component consists of a concept-based question bank, rubric-based answer
assessment, structured answer-state classification, a deterministic follow-up questioning
policy, response-hesitation analysis, gap differentiation, and a feedback and reporting
module.




                                                                                             11
```


## Source PDF page 13, Printed page 12

```text
The system will use answer correctness, follow-up responses, and limited hesitation
indicators to determine whether performance is more indicative of a likely knowledge gap or
a communication difficulty. The type of follow-up will be controlled by an inspectable rule-
based policy, while AI will be used to interpret responses and naturally phrase or rephrase the
selected follow-up question.Research on prompting in oral assessment distinguishes between
clarification, probing, and leading questions and emphasizes neutrality, consistency, and
transparency when follow-up questioning is used [13]. This supports the decision to keep the
follow-up strategy controlled rather than allowing unrestricted AI-generated questioning.

The component will serve as a knowledge-verification and assessment layer. It will not
replace the functions of the other AdaptLearn components, but will use relevant information
such as topic, mastery, learner-state, and course-content information provided by them.



Relevant SDG alignment

The research mainly aligns with SDG 4 – Quality Education through the use of personalised
formative assessment and more suitable learner feedback.

It also has secondary alignment with SDG 10 – Reduced Inequalities, as accent,
pronunciation style, and overall voice quality will not be used as correctness indicators, while
hesitation evidence will only be used as supporting information.

Research cluster alignment

The research fits under SLIIT's Centre of Excellence for Artificial Intelligence (CoEAI)
research cluster and the Education Technology / e-Learning / Intelligent Tutoring Systems
domain.

The Intelligent Viva System brings together Natural Language Processing, Adaptive
Assessment, Learner Modelling, and speech-based interaction to support oral knowledge
verification.




                                                                                             12
```


## Source PDF page 14, Printed page 13

```text
1.2 Literature Review

               Research on oral assessment, AI-supported questioning, and speech-based behavioral
               analysis provides the main foundation for the proposed intelligent viva system. The most
               relevant studies are reviewed below in terms of their method, dataset, context, findings,
               strengths, limitations, and influence on the proposed research

                                                          TABLE 1 LITERATURE REVIEW

Ref.   Study and method             Dataset / Context              Main findings             Strengths and          Influence on proposed research
                                                                                             limitations
[6]    Abuzied and Nabag            24 studies in          Structured vivas showed           Strength: combines     Supports using a structured
       conducted a systematic       health-professions     better reliability than           evidence from          question and rubric design
       review and meta-analysis     education were         traditional vivas. Reported       multiple viva          rather than an unrestricted viva.
       of structured viva           reviewed; 12           Cronbach's alpha values           studies and directly   It also supports the decision to
       examinations.                contained              reached 0.75–0.80,                compares               make follow-up selection rule-
                                    sufficient data for    compared with 0.50 for            structured and         guided and auditable.
                                    the acceptability      traditional viva in one           traditional
                                    meta-analysis.         comparison. Overall learner       approaches.
                                                           acceptability was 79.8%.          Limitation: studies
                                                                                             were mainly from
                                                                                             health-professions
                                                                                             education and
                                                                                             showed high
                                                                                             heterogeneity;
                                                                                             limited data
                                                                                             prevented pooled
                                                                                             effect-size
                                                                                             calculation for
                                                                                             validity and
                                                                                             reliability.
[7]    Davey et al. used a          722 students at the    Final-assessment and overall      Strength: large        Supports the use of interactive
       mixed-methods                University of South    course performance                longitudinal dataset   probing and clear rubrics, while
       comparison of interactive    Australia from         improved significantly after      with both              showing the importance of
       oral assessment before       2009–2023; 590         IOA introduction. No              quantitative and       student preparation, fairness,
       and after its introduction   were from pre-IOA      significant differences were      qualitative            and communication-related
       in an undergraduate          cohorts and 132        found according to gender,        evidence.              factors during viva assessment
       genetics course.             from post-IOA          domestic/international            Limitation: it was
                                    cohorts.               status, or first-language         conducted within
                                                           background. Students              one bioscience
                                                           initially reported anxiety, but   course and was not
                                                           perceptions improved with         a randomized
                                                           experience.                       experiment, so
                                                                                             improvements
                                                                                             cannot be
                                                                                             attributed only to
                                                                                             oral assessment.
[8]    Cao and Zahid developed      User acceptance        AutoViva generates viva           Strength:              Shows the feasibility of
       AutoViva, a Moodle-          testing involved 10    questions from coursework         demonstrates that      automating viva processes, but
       based generative-AI viva     students. The          specifications and student        AI-supported viva      motivates the proposed
       system, and evaluated        system was also        submissions. Sixty percent of     functionality can be   system's live adaptive
       usability and scalability.   load-tested from       participants rated the            integrated with an     questioning, structured
                                    100 to 1,000           experience Excellent and          LMS and scaled         answer states, and controlled
                                    concurrent users.      40% Good. The load test           technically.           follow-up policy.


                                                                                                                                    13
```


## Source PDF page 15, Printed page 14

```text
maintained submission            Limitation: the user
                                                          throughput as concurrency        study was very
                                                          increased.                       small, responses
                                                                                           were recorded
                                                                                           rather than a fully
                                                                                           adaptive live viva,
                                                                                           and the study did
                                                                                           not evaluate
                                                                                           knowledge-versus-
                                                                                           communication
                                                                                           differentiation.
[9]   Harrington and Joordens       1,131 university      Students generally reported      Strength: large real-    Supports the feasibility of AI-
      investigated AI-facilitated   students              positive experiences related     world deployment         mediated oral assessment at
      oral assessment in a          completed an AI-      to fairness, depth of            demonstrating that       scale, while reinforcing the
      large introductory            facilitated mock      processing, and                  conversational AI        need to validate system
      psychology course.            oral evaluation.      conversational interaction.      can make oral            judgements against human
                                                          Thirty-seven percent stated      assessment more          raters instead of assuming that
                                                          that the upcoming oral           scalable.                an AI interviewer is accurate.
                                                          assessment encouraged            Limitation: much of
                                                          them to take the learning        the evidence
                                                          activity more seriously and      concerns student
                                                          avoid AI use in their own work   perception and
                                                                                           behaviour rather
                                                                                           than validated
                                                                                           knowledge
                                                                                           classification, and it
                                                                                           does not separate
                                                                                           knowledge difficulty
                                                                                           from
                                                                                           communication
                                                                                           difficulty.
[5]   Taptiklis et al. used         Speech recordings     The best Gradient Boosting       Strength: large          Supports examining speech
      machine learning to           from 2,764 healthy    model achieved an AUC of         participant sample       behaviour, but also justifies the
      investigate whether vocal     adults completing     0.99 on the full validation      and held-out             conservative decision to treat
      acoustic features could       a backwards digit-    dataset and 0.95 for fixed       validation data.         response-hesitation
      predict mental effort.        span task were        four-digit trials.               Limitation: the task     indicators only as
                                    divided into                                           was a controlled         supplementary evidence,
                                    training, test, and                                    cognitive test, not      alongside answer correctness
                                    validation                                             an educational viva,     and follow-up responses.
                                    datasets.                                              and mental effort is
                                                                                           not equivalent to
                                                                                           knowledge,
                                                                                           confidence, or
                                                                                           communication
                                                                                           ability



          Synthesis of the literature

          The reviewed studies provide evidence that structured oral assessment can expose student
          understanding more directly than relying only on written or selected-response assessment.
          However, the literature also identifies important challenges involving examiner consistency,
          scalability, anxiety, and the interpretation of spoken performance [6], [7].



                                                                                                                                    14
```


## Source PDF page 16, Printed page 15

```text
Recent work demonstrates that generative AI can reduce the scalability problem by generating or
conducting oral questioning [8], [9]. Nevertheless, existing research mainly focuses on either
conducting the viva, authenticating coursework, or scaling oral assessment. Less attention is
given to determining why a student performs poorly during the interaction. Broader higher-
education research similarly indicates that effective oral assessment depends on structured
design, transparent rubrics, appropriate prompting, and consistent implementation [12], [14].

This limitation directly influences the proposed research. The Intelligent Viva System will
therefore not allow an LLM to freely control the entire assessment. Instead, student responses
will be evaluated using human-defined reference answers and rubric points, classified into
structured answer states, and passed to a deterministic questioning policy. AI will assist with
response interpretation and natural phrasing, while the assessment path remains controlled.

The speech-related literature also influences the design. Although vocal characteristics can
provide information about mental effort [5], they cannot reliably prove that a learner lacks
knowledge or confidence. Therefore, response latency, pauses, filler words, hedging, and answer
restarts will only contribute supporting evidence. The final assessment will place greater
importance on the actual content of the answer and the student's behaviour across structured
follow-up questions.

Existing systems and products

Several existing systems already address parts of the oral-assessment or communication-practice
problem, but none fully address the research problem targeted by this component.

AutoViva is a generative AI tool that processes coursework and student submissions into viva
questions [8]. The system certainly enhances scalability, but it prioritizes coursework validation
over live adaptive evaluations.

The AI-based oral assessment solution proposed by Harrington and Joordens indicates that
conversational AI can carry out oral assessments within large student groups [9]. Nonetheless, it
does not put emphasis on distinguishing gaps in knowledge from gaps in communication
abilities.

Yoodli AI is an interview and communications practice tool that provides the feedback on
aspects such as speed of speaking, use of fillers, and clarity [10]. Nevertheless, it serves as a
communication coaching tool rather than an academic proficiency checker

The new Intelligent Viva System meets the aforementioned challenges by integrating structured
answer evaluation, supervision of the follow-up questions, signs of hesitations, and gap
distinction.


                                                                                                    15
```


## Source PDF page 17, Printed page 16

```text
Limitations addressed by the proposed component

Research has identified a common limitation affecting human vivas, as well as computerized
systems. While human vivas provide various data, they are often not scalable, whereas
computerized systems enable scaling but may have inherent flexibility in the questioning process
that would pose challenges for auditing. Finally, communication coaching tools mainly analyze
the delivery but not the actual lack of knowledge.

The present Intelligent Viva System allows to overcome both limitations by implementing the
rubric-based answer assessment, structured evaluation of answer state, deterministic adaptive
follow-up questioning, indication of response hesitance, and gap evaluation all together. The
intention of the suggested tool is not to evaluate the state of mind of students but to find out
through the available data whether the evidence indicates the gap in knowledge or
communication and to offer appropriate follow-up support.




                                                                                                   16
```


## Source PDF page 18, Printed page 17

```text
1.3 Research Gap

     According to previous studies, structured viva assessments can enhance reliability and
     yield stronger evidence of students’ comprehension [6], [7]. Recent AI-related systems,
     such as AutoViva and large-scale systems of conversational oral evaluation, indicate the
     automation and scalability of certain aspects of vivas [8], [9]. However, the existing
     methods are limited to structured assessment, scalability, coursework verification, and
     general oral communication.

     The crucial problem, however, remains underexplored because weak performance during
     vivas can be attributed either to a true knowledge gap or to a challenge in delivering
     knowledge that is possessed by the student. The present-day approaches do not
     adequately combine the correctness of answers, effective adaptive follow-up questions,
     and the evidence of hesitation in the response [8], [10].

     Existing oral-assessment research provides guidance on structured prompting [13] and
     identifies anxiety and other performance-related factors that can influence oral
     assessment outcomes [15]. However, these aspects have not been sufficiently combined
     to differentiate likely knowledge gaps from communication difficulties during technical
     viva assessment.

     The Intelligent Viva System is going to investigate whether the combination of
     structured assessment approach, deterministic effective adaptive follow-up questions,
     and additional evidence of hesitation in responses can be utilized for determining
     possible gaps in knowledge as opposed to challenges in delivering the knowledge during
     a technical viva.

     Statement of the research gap
     Current viva system with AI support can successfully implement or scale oral
     assessments, but it does not clearly distinguish between the reasons for poor
     performance, such as a lack of knowledge vs. inability to express knowledge. This study
     will explore an adaptive viva paradigm that enables the distinction between these two
     types of weak performance using the content of answers, follow-up questions, and
     hesitation indicators.




                                                                                           17
```


## Source PDF page 19, Printed page 18

```text
2. Objectives

2.1 Main Objective
To develop and evaluate an Intelligent Viva System that uses structured answer assessment,
deterministic adaptive follow-up questioning, and supplementary response-hesitation evidence to
differentiate likely knowledge gaps from communication difficulties during a technical viva, and
provide appropriate communication-improvement guidance where needed.

2.2 Specific Objectives

   1. To develop a structured viva question bank with concept-based questions, answers, rubric
      points, misconceptions, and follow-up pathways, together with an answer-assessment
      mechanism that assesses student responses and categorizes them into predefined answer
      states: complete answer, partial answer, superficial answer, incorrect answer,
      misconception-bearing answer, and non-answer.
   2. To develop a deterministic follow-up policy that decides the next action in the
      questioning process based on the state of the answers, the depth of questioning, and
      previous answers.
   3. To analyze response-hesitation indicators, such as pauses, response latency, filler words,
      hedging, and answer restarts, as supplementary evidence during the viva, and to develop
      a gap-differentiation mechanism that combines answer-content evidence, follow-up
      responses, and hesitation indicators to identify whether poor performance more strongly
      suggests a likely knowledge gap or a communication difficulty.
   4. To evaluate the proposed system by comparing its answer classification and gap-
      differentiation results with human-rater judgements, and by assessing the appropriateness
      of its constrained follow-up questioning.




                                                                                              18
```


## Source PDF page 20, Printed page 19

```text
3. Methodology

3.1 Research Methodology / Research Design

This research will follow a Design Science Research (DSR) methodology supported by a
controlled quantitative evaluation. Design Science Research is appropriate because the study
involves the development and evaluation of a technological artefact intended to address an
identified real-world problem [11]. In this research, the artefact is the proposed Intelligent Viva
System.
The main research question investigates whether structured answer assessment, deterministic
adaptive follow-up questioning, and supplementary response-hesitation indicators can support
the differentiation of likely knowledge gaps from communication difficulties during technical
viva assessments. Therefore, the research requires both the development of a working prototype
and an experimental evaluation of its performance.
The study will mainly generate quantitative data, including answer classifications, knowledge-
check scores, follow-up responses, hesitation indicators, system assessments, and human-
examiner judgements. Previous studies have shown that structured oral assessments can provide
useful evidence of student understanding [6], [7], while recent studies demonstrate the feasibility
of AI-supported oral assessment [8], [9]. However, the proposed research specifically
investigates whether additional evidence gathered during an adaptive viva can help explain the
likely reason for weak performance.
Therefore, Design Science Research with controlled quantitative experimental evaluation will be
used as the research methodology.

3.2 Data/Participants/Experimental Inputs

The main dataset for this research will be a primary dataset collected through participant viva
sessions. An existing public dataset alone is not sufficient because the study requires a specific
combination of technical answers, adaptive follow-up responses, hesitation indicators,
knowledge-check results, and human judgements.

Approximately 20–30 undergraduate students from IT or Computer Science-related programmes
will be recruited, subject to ethical approval and participant availability. A small number of
undergraduate computing concepts, such as Data Structures and Algorithms, Object-Oriented
Programming, or Database Systems, will be selected for the experiment.

For each selected concept, a structured viva question bank will be prepared containing a main
question, reference answer, rubric points, common misconceptions, and predefined follow-up
pathways.


                                                                                                     19
```


## Source PDF page 21, Printed page 20

```text
Before the viva, participants will complete a short written knowledge check covering the
selected concepts. This will provide additional evidence of conceptual understanding outside the
oral assessment.

Participants will then complete a structured technical viva using the Intelligent Viva System.
During the session, the system will collect the participant's spoken responses, transcripts, follow-
up responses, answer-state classifications, and response-hesitation indicators such as response
latency, pauses, filler words, hedging, and answer restarts. A short post-viva self-report may also
be collected to understand difficulties experienced by participants while answering.

The resulting dataset will therefore contain knowledge-check results, initial viva responses,
follow-up responses, hesitation indicators, system classifications, and human-examiner
judgements.

Two human raters with suitable computing knowledge will independently evaluate selected
responses without viewing the system's final decision. Responses will first be classified into the
six predefined answer states: Complete, Partial, Superficial, Incorrect, Misconception-bearing,
and Non-answer. At the concept level, the raters will also assess whether the available evidence
more strongly suggests a Likely Knowledge Gap, Likely Communication Difficulty, or
Mixed/Insufficient Evidence.

The collected data will be anonymised and organised according to participant, concept, question,
response, and follow-up stage before analysis. A small pilot dataset may be collected during
development, while the final participant data will be reserved for the main evaluation.

Public speech datasets may be used as secondary development resources for testing speech-
related features such as pause or filler-word detection, but they will not replace the primary
dataset used to answer the main research question.

3.3 Baseline/Benchmark
The main baseline for this research will be an answer-content-only assessment. Under this
baseline, the student's performance will be assessed using only the content of the initial response
to the viva question, without using adaptive follow-up responses or response-hesitation
indicators. The proposed approach will then be evaluated using three evidence conditions:

                                 TABLE 2 BASELINE/BENCHMARK TABLE

                   Condition                                       Evidence Used
 A - Baseline                                      Initial answer content only
 B - Adaptive Viva                                 Initial answer + structured follow-up
                                                   responses



                                                                                                  20
```


## Source PDF page 22, Printed page 21

```text
C - Proposed Full Approach                       Initial answer + structured follow-up
                                                  responses + response-hesitation indicators


The same participant data can be analysed under all three conditions; therefore, three separate
systems or participant groups are not required.

This comparison will allow the research to determine whether the additional evidence introduced
by adaptive questioning and hesitation analysis improves gap differentiation. If Condition B
performs better than Condition A, it would indicate that follow-up responses provide useful
additional evidence. If Condition C improves further, it would indicate that response-hesitation
indicators contribute additional supporting information.

Human-examiner judgement will be used as the reference standard rather than as the baseline.

Therefore, the main benchmark will compare the proposed adaptive multi-evidence approach
against an answer-content-only assessment using independent human-examiner judgement as the
reference.

3.4 Evaluation Metrics
                                 3. EVALUATION METRICS TABLE

             Metric                       Why Relevant                      Comparison

 Accuracy                         Measures how often the           Compared with human-rater
                                  system classification matches    labels
                                  the human judgement
 Macro F1-score                   Measures performance across      Baseline vs proposed
                                  all answer classes, including    approach
                                  less frequent classes
 Cohen's Kappa                    Measures agreement between       Compare Conditions in
                                  the system and human             baseline
                                  judgement beyond chance
 Follow-up Appropriateness        Checks whether the selected      Rated by a lecturer or subject
                                  follow-up question is relevant   expert
                                  and suitable
 Feedback Usefulness              Measures whether the final       Participant or expert rating
                                  learning or communication
                                  guidance is useful


For the main gap-differentiation task, the three conditions will be compared:




                                                                                                  21
```


## Source PDF page 23, Printed page 22

```text
A - Initial answer only
B - Initial answer + follow-up responses
C - Initial answer + follow-up responses + hesitation indicators

The proposed approach will be considered useful if Conditions B and C show better agreement
with human judgement than the answer-content-only baseline.



3.5 Validation Strategy
The system will be validated using expert review, pilot testing, and comparison with human
judgement.

Before the main experiment, the question bank, reference answers, rubric points, misconceptions,
and follow-up pathways will be reviewed by a lecturer or suitable subject expert.

A small pilot study will then be conducted to test the viva process, speech transcription, answer
assessment, follow-up questioning, and hesitation analysis. Necessary improvements will be
made before the final evaluation.

During the final evaluation, human raters will independently review selected student responses.
Their judgements will be compared with the system results.

The final evaluation will first consider the student’s initial answer on its own. The same response
will then be assessed together with the student’s follow-up answers. Finally, the hesitation
indicators will also be included. This will make it possible to examine whether each additional
source of evidence improves the system’s ability to distinguish likely knowledge gaps from
communication difficulties. This will show whether the additional evidence improves the
differentiation of likely knowledge gaps from communication difficulties.

Cases with unclear evidence will be reported as Mixed/Insufficient Evidence instead of forcing a
classification.

3.6 Development Approach
The system will be developed using an iterative prototyping approach. Development will
begin with the structured question bank and answer-assessment mechanism, followed by the
deterministic follow-up policy, speech transcription, hesitation analysis, gap differentiation, and
feedback/reporting functions.

Each part will be tested and refined before the final prototype is evaluated. The follow-up
strategy will remain controlled. AI may assist with understanding student responses and phrasing
questions naturally, but the next questioning action will be selected according to the predefined
follow-up policy.

                                                                                                  22
```


## Source PDF page 24, Printed page 23

```text
4. High-level system architecture

4.1 Overview of proposed solution and components
The AdaptLearn system consists of 4 connected components that form a learner-aware learning
and assessment environment

C01 – Adaptive Curriculum Engine: This Maintains learner mastery information and
recommends suitable learning topics.

C02 – Cognitive Load Detection: Provides information about the learner's current load,
frustration, and engagement state.

C03 – AI Tutoring and Explanation: Provides course-focused explanations and learning support.

C04- Intelligent Viva System: Verifies students' understanding through structured technical viva
sessions and differentiates likely knowledge gaps from communication difficulties.




            FIGURE 1 HIGH-LEVEL ADAPTLEARN SYSTEM ARCHITECTURE WITH C04 HIGHLIGHTED




                                                                                              23
```


## Source PDF page 25, Printed page 24

```text
4.2 Individual Component Architecture

The intelligent viva system has a few internal components that work together to hold a proper
viva session.

The system starts with selecting a suitable concept or topic using available mastery information
from C01. This could also be done by selecting manually from the available topics for the viva
sessions. The system then delivers a structured viva session and captures the students' responses
through speech-to-text input or text, where required.

The response is converted into text and evaluated against predefined reference answers and
rubrics. Based on this evaluation, the answer is classified into one of the existing answer states.
The follow-up policy then selects the next questioning action using the answer state, questioning
depth, and previous responses.

During the session, response hesitation indicators such as pauses, slow responses, filler words,
hedging, and answer restarts are collected as supplementary evidence. The system combines
answer content, follow-up question performance, and hesitation evidence to determine whether
the performance more strongly suggests a likely knowledge gap, a communication difficulty, or
insufficient mixed evidence.

The sessions then end with a viva feedback report. Where communication difficulty is found, the
system provides communication improvement guidance to the student. Where a likely
knowledge gap is indicated, the leaner maybe be prompted to review suitable material for
review.




                                                                                                 24
```


## Source PDF page 26, Printed page 25

```text
FIGURE 2 INTELLIGENT VIVA SYSTEM INTERNAL ARCHITECTURE




                                                         25
```


## Source PDF page 27, Printed page 26

```text
4.3 Overall Integration

The intelligent viva system integrates with other AdaptLearn system components through clearly
defined data exchanges.

C01 provides the topic and subject mastery information that can be used to select a topic for the
viva session and to decide the starting depth of the questions in the session. C04 doesn’t directly
modify the mastery level for C01. If the viva provides evidence of a likely knowledge gap, the
Intelligent viva component only sends a review notification or a recommendation back to the
C01 Component

C02 provides the students' state information such as cognitive loads, frustrations, or
engagements. This information may be used to adjust the viva prompting time for the learner,
and the viva session length will also be decided according to the information.

C03 provides the relevant course materials that can support the creation of viva questions,
reference answers, and rubric information. After the viva, the intelligent viva system may also
direct a student to relevant course materials when additional review is recommended.

The planned integration will use REST API based communication with JSON data exchange
between the components.




                                      TABLE 3 INTEGRATION TABLE

 Component Direction            Information Exchanged
 C01       Inbound              Topic and mastery information for viva selection and starting
                                depth
 C01           Outbound         Review notification when evidence suggests a likely knowledge
                                gap
 C02           Inbound          Cognitive load information for timing , prompting or session
                                length
 C03           Inbound          Relevant course content for questions , reference answers and
                                rubric preparation
 C03           Outbound         Recommend review material after the viva session




                                                                                                  26
```


## Source PDF page 28, Printed page 27

```text
4.4 Individual Responsibility Boundary

                                 TABLE 4 RESPONSIBILITY TABLE

      Activity / Deliverable             My                 Shared         Other Member
                                     Responsibility      Responsibility
Viva Question and rubric bank             ✓

Answer assessment and answer                ✓
state classification
Deterministic follow-up policy              ✓

Response hesitation analysis                ✓

Gap differentiation mechanism               ✓

Feedback and communication                  ✓
improvement guidance
C01/C02/C03 integration interfaces                              ✓         Other component
                                                                          members
Adaptive Curriculum Engine                                                C01 Member


Cognitive Load Detection                                                  C02 Member

AI tutoring and Explantion                                                C03 Members


End to end AdaptLearn Integration                               ✓         All Members




                                                                                            27
```


## Source PDF page 29, Printed page 28

```text
5. User Requirements

5.1 Requirements identification
The main users of this Intelligent viva system are undergraduates who participate in technical
viva assessments and lectures, or subject experts/lecturers who review assessment outcomes. A
student survey was distributed to identify the needs for verbal explanation, viva practice, viva
follow-up questions, feedback, and hesitations.

The questions are :

Q1: Have you ever understood a topic but found it difficult to explain it verbally?
Q2: How often do you practice explaining technical concepts verbally?
Q3: Would an AI-based viva conversation help you confirm your understanding?
Q4: Which benefits would you expect from an Intelligent viva system?
Q5:Would follow-up questions help you explain your understanding better?
Q6: What feedback would help you most after answering technical questions?
Q7:How comfortable are you with pauses and response delays being used as supporting
information?


The results of the survey revealed that numerous students have trouble in verbalizing the
technical concepts even if they understand it. The students expressed their willingness to answer
any follow-up questions, receive constructive feedback after the viva, and help in understanding
any gaps in knowledge or communication.


Functional Requirements

                              TABLE 5 FUNCTIONAL REQUIREMENTS TABLE

 ID   Category                        Requirements and Measure
 FR01 Assessment Management           The system selects or receives a suitable topic based on
                                      available learner and course information
 FR02 Assessment Management           The system shall present structured viva questions from
                                      the predefined question bank
 FR03 Input Processing                The system shall capture students' responses through
                                      speech and provide a text option as well
 FR04 Assessment processing           The system shall evaluate students' responses against
                                      reference answers and rubric points

                                                                                                 28
```


## Source PDF page 30, Printed page 29

```text
FR05 Assessment processing       The system shall classify responses as complete, partial,
                                 superficial, Incorrect, misconception-bearing, or non-
                                 answer
FR06 Adaptive Interaction        The system shall select suitable follow-up questions based
                                 on answer state
FR07 Behavioral Analysis         The system shall analyze response-hesitation indicators
                                 such as pauses, slow replies, filter words, and answer
                                 restarts
FR08 Decision Support            The system shall combine answer content, follow-up
                                 responses, and hesitation evidence to identify whether
                                 weak performance more strongly suggests a likely
                                 knowledge gap, communication difficulty, or
                                 mixed/insufficient evidence.
FR09 Feedback and Reporting      The system shall generate a post-viva summary
                                 containing viva outcome and suitable learning or
                                 communication improvement guidance
FR10 Feedback and Reporting      The system shall recommend relevant course material for
                                 reviewing incase likely knowledge gap
FR11 System Integration          The system shall exchange information with other
                                 AdaptLearn components


Non Functional Requirements

                        TABLE 6 NON FUNCTIONAL REQUIREMENTS TABLE

ID    Category        Requirements and Measure
NFR01 Performance      The system should present the new viva question within
                      approximately 5 seconds after processing the student's response
NFR02 Security        Only authorized users shall be able to access viva and assessment
                      information
NFR03 Privacy         Participant data used for research shall be anonymized

NFR04 Usability     The system shall provide a simple interface that slows student to
                    complete the viva without extensive training
NFR05 Reliability   Completed responses and viva progress shall be saved during the
                    session to reduce data loss if failure occurs
NFR06 Accessibility The system shall provide a typed-response option where speech input
                    cannot be used
NFR07 Scalability   The system shall support multiple independent viva sessions without
                    mixing user sessions data




                                                                                          29
```


## Source PDF page 31, Printed page 30

```text
6. Commercialization Plan

6.1 Target Market and Customer Persona

The main target market is the higher education sector, specifically universities and colleges
offering IT and computer science courses. The main customer persona will be academic
professors, departments, assessment coordinators, or e-learning units that require a structured
viva assessment process in order to provide evaluations in a consistent manner.

 The secondary target markets include EdTech companies and LMS providers who may consider
integrating the oral assessment and feedback features in their solutions.

6.2 Value proposition

The Intelligent Viva System is a systematic and adaptive method of carrying out technical viva
assessments. The system uses already developed rubrics for evaluating the answers given by the
students, uses deterministic types of policies for follow-ups, and incorporates the hesitation
indicators of responses into the assessment as additional evidence.

The significant benefit of the system lies in its ability to initially provide better assessment
evidence in cases when a student is not performing properly. Instead of looking at whether the
answer is right or wrong, the system attempts to find out whether any evidence available
suggests that there has been either a likely knowledge gap or a c likely communication gap in the
given response. Based on those conclusions, the system gives recommendations for learning a
subject or improving communication skills.

This can help reduce the amount of repetitive questions and make viva assessments more
uniform and consistent.

6.3 Revenue Model
A Software-as-a-Service (SaaS) model is proposed. Institutions can subscribe on an annual basis.
Alternatively, a white-label licensing model can be offered to EdTech companies that wish to
integrate the component into their own platforms.

6.4 Pricing Strategy
               •   Institutional license: Annual subscription based on the number of active
                   students
               •    API / white-label license: Usage-based or annual licensing fee for EdTech
                   and LMS providers.


                                                                                                  30
```


## Source PDF page 32, Printed page 31

```text
•    Free trial/pilot version: A limited version may be provided to lecturers or
                  institutions for evaluation before purchasing a full subscription.
              •   Department/module package: Lower-cost subscription for a specific course or
                  academic department.


6.5 Competitive Advantage
The main competitive advantages are:

              •   Adaptive and Structured technical viva questioning.
              •   Deterministic follow-up policy rather than AI-generated questioning
              •   Rubric-based answer assessment and predefined answer state classifications
              •   Differentiate likely knowledge gaps from likely communication gaps
              •   Use of hesitation analysis to get proper evidence for student analysis
              •   Post-viva improvement guidance to the student
              •   Option to integrate with AdaptLearn System and its features
              •   Designed best for university students

6.6 Intellectual Property Considerations
Copyright of the software and/or proprietary implementation methods may be available to defend
against unauthorized use of the software, assessment workflow, formatted question-bank and the
logic used to determine the gaps (deterministic follow-up policy).

Question banks, rubrics, Assessment content can be maintained by the relevant educational
institution. A dual-licensing strategy can also be used – that is, selected core functions made
available under an academic (or research) license, whereas advanced institutional and integration
features are provided under a commercial license.




                                                                                               31
```


## Source PDF page 33, Printed page 32

```text
7. Budget and Justification
                                  TABLE 7 BUDGET TABLE

Category               Item/Service           Estimated     Justification
                                              Cost (LKR)
Hardware               Existing                     0       Existing personal hardware
                       laptop/computer                      will be used for development
                       and microphone
Software               React, Python, Fast         0        Open-source and freely
                       API/Node.js,                         available tools will be used for
                       speech/audio                         application development and
                       libraries, and                       audio processing
                       development tools
Speech-to-text         Web Speech API /            0        Free speech-recognition
                       open-source speech                   methods will be used initially
                       tools                                to convert viva responses into
                                                            text
Text-to-speech         Web Speech                  0        Browser-based speech
                       Synthesis API                        synthesis can provide voice
                                                            output for viva questions
                                                            without additional cost
Answer Assessment/AI   Web Speech                  0        Free-tier services can support
                       Synthesis API                        development and preliminary
                                                            testing of answer interpretation
                                                            and classification
Hesitation Analysis    Open-source                 0        Libraries such as librosa or
                       Python audio-                        similar tools can be used to
                       processing libraries                 analyse pauses and other
                                                            measurable speech features
                                                            without licence fees
Database               Free-tier hosted            0        Free development tiers
                       database
Optional Cloud/API     Paid LLM, speech-      5000-10,000 A small contingency is
usage                  to-text, or hosting                allocated in case free-tier rate
                       during final                       limits, reliability issues, or
                       evaluation                         technical-vocabulary
                                                          recognition problems occur
                                                          during final participant testing
Human Effort           Researcher             0-In-kind   will be carried out by the
                       development and                    student researcher
                       evaluation work
Human Effort           Lecturer/domain-       0-In-Kind     evaluation results is expected
                       expert review                        to be provided as academic or
                                                            voluntary research support.



                                                                                             32
```


## Source PDF page 34, Printed page 33

```text
Estimated Budget
The project can be developed using only free services at an estimated direct cost of LKR 0.

However, a contingency budget of approximately LKR 5,000–15,000 will be reserved for
selective paid API or cloud usage during the final evaluation period if required.

Budget Justification
The project does not require specialized hardware or permanent paid software licenses. Browser-
based speech technologies, open-source audio-processing libraries, free-tier databases,
development frameworks, and hosting platforms are sufficient for developing and testing the
prototype.

The development strategy will therefore follow a free-first approach. Paid services will only be
introduced when a specific limitation is identified. For example, a paid speech-to-text service
may be considered if the free solution performs poorly with technical terminology, while a paid
LLM API may be used temporarily if free-tier rate limits affect final testing.




                                                                                              33
```


## Source PDF page 35, Printed page 34

```text
8. Work Breakdown Structure (WBS)




                               FIGURE 3 WORK BREAKDOWN STRUCTURE



The Figure shows the work breakdown structure for the Intelligent Viva System. The work is
divided into Literature and planning, Requirements and Designs, Development, Testing and
Integration, Evaluation and analysis, and finally documentation across the project time range to
maintain proper planning




                                                                                               34
```


## Source PDF page 36, Printed page 35

```text
9. Gantt Chart
Below is the planned Gantt Chart for the Intelligent Viva system/ This shows the planned
process of the literature work, research designs, data preparation, experiments, development,
prototyping, testing, system integration, evaluation, analysis, and report creation




                                          FIGURE 4 GANTT CHART



                                                                                                35
```


## Source PDF page 37, Printed page 36

```text
10. References List

[1] S. Richter and P. Dodd, “The case for oral exams in the age of AI,” University of Auckland,
Oct. 2, 2025. Accessed: Sep. 14, 2026. [Online]. Available:
https://www.auckland.ac.nz/en/news/2025/10/02/the-case-for-oral-exams-in-the-age-of-ai.html

[2] P. Sotiriadou, D. Logan-Fleming, H. Huijser, and A. Warner, “The value of oral assessments
and vivas in the age of Gen AI,” Needed Now in Learning and Teaching, Oct. 14, 2024.
Accessed: Sep. 14, 2026. [Online]. Available: https://eprints.qut.edu.au/254362/

[3] J. Freeman, Student Generative AI Survey 2025, HEPI Policy Note 61. Oxford, U.K.: Higher
Education Policy Institute, Feb. 2025. Accessed: Sep. 14, 2026. [Online]. Available:
https://www.hepi.ac.uk/reports/student-generative-ai-survey-2025/

[4] W. A. S. C. Weerasinghe and H. M. P. P. K. Abeysinghe, “Usage of Artificial Intelligence
(AI) tools for academic activities by undergraduate students: A quantitative study at the Sri
Lanka Institute of Information Technology (SLIIT) Library,” 2024. [Online]. Available:
https://doi.org/10.5281/zenodo.13959106

[5] N. Taptiklis, M. Su, J. H. Barnett, C. Skirrow, J. Kroll, and F. Cormack, “Prediction of
mental effort derived from an automated vocal biomarker using machine learning in a large-scale
remote sample,” Frontiers in Artificial Intelligence, vol. 6, Art. no. 1171652, 2023. [Online].
Available: https://doi.org/10.3389/frai.2023.1171652

[6] A. I. H. Abuzied and W. O. M. Nabag, “Structured viva validity, reliability, and acceptability
as an assessment tool in health professions education: A systematic review and meta-analysis,”
BMC Medical Education, vol. 23, Art. no. 531, 2023. [Online]. Available:
https://doi.org/10.1186/s12909-023-04524-6

[7] S. K. Davey, D. Birbeck, S. Nallaya, G. Sallows, and C. B. Della Vedova, “Utilising one-on-
one interactive oral assessments as the major final assessment within a bioscience course,”
Assessment & Evaluation in Higher Education, vol. 50, no. 7, pp. 1154–1171, 2025. [Online].
Available: https://doi.org/10.1080/02602938.2025.2502577

[8] H. Cao and S. Zahid, “Automated viva voce using generative AI for student coursework
authentication,” in Proc. 2025 International Conference on Educational Technology and
Artificial Intelligence (ETAIC 2025), Wuhan, China, Jul. 25–27, 2025. [Online]. Available:
https://doi.org/10.1145/3766557.3766564

[9] B. Harrington and S. Joordens, “Scaling authentic assessment-Interaction design and
student sentiment in AI-facilitated oral examinations,” in Proc. 8th Annual Symposium on HCI

                                                                                                36
```


## Source PDF page 38, Printed page 37

```text
Education (EduCHI 2026), Toronto, ON, Canada, May 20–22, 2026, pp. 1–11. [Online].
Available: https://doi.org/10.1145/3803869.3803889

[10] Yoodli, “AI roleplays for interview preparation and coaching,” Yoodli. Accessed: Sep. 14,
2026. [Online]. Available: https://yoodli.ai/use-cases/interview-preparation

[11] A. R. Hevner, S. T. March, J. Park, and S. Ram, “Design science in information systems
research,” MIS Quarterly, vol. 28, no. 1, pp. 75–105, Mar. 2004. [Online]. Available:
https://doi.org/10.2307/25148625

[12] S. Nallaya, S. Gentili, S. Weeks, and K. Baldock, “The validity, reliability, academic
integrity and integration of oral assessments in higher education: A systematic review,” Issues in
Educational Research, vol. 34, no. 2, pp. 629–646, 2024. [Online]. Available:
https://www.iier.org.au/iier34/nallaya.pdf

[13] J. Pearce and N. Chiavaroli, “Prompting candidates in oral assessment contexts: A
taxonomy and guiding principles,” Journal of Medical Education and Curricular Development,
vol. 7, pp. 1–4, 2020. [Online]. Available: https://doi.org/10.1177/2382120520948881

[14] M. Ward, F. O’Riordan, D. Logan-Fleming, D. Cooke, T. Concannon-Gibney, M.
Efthymiou, and N. Watkins, “Interactive oral assessment case studies: An innovative,
academically rigorous, authentic assessment approach,” Innovations in Education and Teaching
International, vol. 61, no. 5, pp. 930–947, 2024. [Online]. Available:
https://doi.org/10.1080/14703297.2023.2251967

[15] Z. Stephenson, N. Johnson-Glauch, and S. Cruchley, “Interventions and facilitators of oral
assessment performance in higher education: A systematic review,” Assessment & Evaluation in
Higher Education, vol. 50, no. 7, pp. 1140–1153, 2025. [Online]. Available:
https://doi.org/10.1080/02602938.2025.2504621

[16] M. Huxham, F. Campbell, and J. Westwood, “Oral versus written assessments: A test of
student performance and attitudes,” Assessment & Evaluation in Higher Education, vol. 37, no.
1, pp. 125–136, 2012. [Online]. Available: https://doi.org/10.1080/02602938.2010.515012

[17] A. Akimov and M. Malin, “When old becomes new: A case study of oral examination as an
online assessment tool,” Assessment & Evaluation in Higher Education, vol. 45, no. 8, pp. 1205–
1221, 2020. [Online]. Available: https://doi.org/10.1080/02602938.2020.1730301

[18] P. Sotiriadou, D. Logan, A. Daly, and R. Guest, “The role of authentic assessment to
preserve academic integrity and promote skill development and employability,” Studies in
Higher Education, vol. 45, no. 11, pp. 2132–2148, 2020. [Online]. Available:
https://doi.org/10.1080/03075079.2019.1582015


                                                                                                 37
```


## Source PDF page 39, Printed page 38

```text
11. Appendices

Appendix1- Student Requirements Survey

A Student survey was created for the AdaptLearn system to identify students' needs. Not all
requirements were taken into account in the survey questions, but other methods were used as
well, such as stakeholder communication.

Click here - AdaptLearn Survey

The questions are :

Q1: Have you ever understood a topic but found it difficult to explain it verbally?




Q2: How often do you practice explaining technical concepts verbally?




Q3: Would an AI-based viva conversation help you confirm your understanding?




                                                                                               38
```


## Source PDF page 40, Printed page 39

```text
Q4: Which benefits would you expect from an Intelligent viva system?




Q5:Would follow-up questions help you explain your understanding better?




Q6: What feedback would help you most after answering technical questions?




                                                                             39
```


## Source PDF page 41, Printed page 40

```text
Q7:How comfortable are you with pauses and response delays being used as supporting
  information?




                                       APPENDIX 1 SURVEY




  Appendix2 – Mandatory Proposal Evidence and Decision Log

                         APPENDIX 2 MANDATORY PROPOSAL AND DECISION LOG

Date       Claim/Problem Evidence               Alternative       Decision Made       Supervisor
                             Collected          Considered                            Discussion
05/08/2026 Weak viva         Literature on      Use only          Investigate the     Suggested
           performance       structured viva    answer            difference          narrowing the
           maybe result of and oral             correctness       between a likely    scope to
           a knowledge       assessments and                      knowledge gap       knowledge-gap
           gap or difficulty communication-                       and                 vs
           explaining        related                              communication       communication-
                             performance                          difficulties        difficulty
                             factors                                                  differentiation.
05/08/2026 Unrestricted      Literature         Fully AI-         Use a               Recommended
           AI-generated      supporting oral    generated         deterministic       keeping follow-
           follow-up         assessment and     follow-ups /      follow-up policy    up questioning
           questions may     controlled         fixed questions   while allowing AI controlled
           reduce            prompting          only.             to naturally phrase rather than fully
           consistency                                            the selected        AI-generated.
                                                                  question.
11/08/2026 Correctness        Literature on     Content-only      Use answer          Advised using
           alone might not    oral assessment   assessment        content, follow-up hesitation
           provide weak       and                                 responses, and      indicators only

                                                                                             40
```


## Source PDF page 42, Printed page 41

```text
oral              speech/hesitation                  supplementary        as supporting
            performance       indicators.                        response-            evidence.
                                                                 hesitation
                                                                 indicators.
17/08/2026 The system         Research scope      Force every    Use Likely           Avoid claims of
           shouldn’t claim    and fairness        result to a    Knowledge Gap,       confidence
           certainty          consideration       knowledge gap Likely                detection or
                                                  or             Communication        definitive
                                                  communication Difficulty, and       diagnosis
                                                  difficulty     Mixed/Insufficient
                                                                 Evidence.
26/08/2026 Response           Privacy/ and        Use hesitation Use pauses,          Agreed to use
           hesitation:        fairness            as primary     latency, fillers,    of other filters
           evidence should    considerations      classifier     hedging, and         as well
           not                and research                       restarts only as
           independently      design                             supplementary
           determine                                             evidence.
           correctness
26/08/2026 Proper             Overall system      Allow C04 to     C04 receives       Don’t directly
           integration to     architecture of     modify learner   information from   change, but
           adapt learn        the team            mastery          C01–C03 and        notify other
           system                                                  sends review       components
                                                                   recommendations
                                                                   only where
                                                                   appropriate.
07/09/2026 User               Proposal            Get              Use survey to      Advised
           requirements       template            requirements     support C04        collecting
           from students      requirements        only from        functional and     student
                              and survey          technical        non-functional     requirements
                                                  design           requirements.      through a
                                                                                      survey before
                                                                                      finalizing
                                                                                      FR/NFRs.
07/09/2026 Suitable           Research            General          Compare initial-   Suggested
           evaluation         question and        usability        answer evidence,   comparing
           method             methodology         testing          follow-up          system
                              literature                           evidence, and      outcomes with
                                                                   follow-up +        human-
                                                                   hesitation         examiner
                                                                   evidence against   judgments.
                                                                   human-examiner
                                                                   judgments.
                        TABLE 8 MANDATORY PROPOSAL EVIDENCE AND LOG TABLES




                                                                                              41
```


## Source PDF page 43, Printed page 42

```text
Appendix3 – AI Use Disclosure
                             APPENDIX 3 AI USAGE DISCLOSURE

AI Tool       Purpose of Use      What was              How Output     Final Student
                                  Generate/Assisted     was Verified   Combination
ChatGPT       Research            Assisted with         Outputs were   All suggestions
              planning,           organizing            reviewed       were manually
              proposal            proposal sections,    against the    reviewed,
              structuring,        improving             original research
                                                                       compared with
              language            wording,              publications,  the university
              assistance, and     discussing            university     proposal
              discussion of       research              proposal       requirements,
              technical           methodology,          guidelines, andand checked
              approaches          reviewing             the student's  against research
                                  document              research       papers and
                                  structure, and        requirements   project decisions
                                  identifying                          before use.
                                  relevant literature                  Content that did
                                                                       not fit the
                                                                       research scope
                                                                       was changed or
                                                                       removed.
Claude        Literature          Assisted in         Publications and Student selected
              research and        identifying and     claims were      the relevant
              proposal-           summarizing         checked against publications,
              development         relevant research   the original     evaluated their
              assistance          related to oral     research papers relevance to the
                                  assessment,         and the          Intelligent Viva
                                  adaptive viva       university       System,
                                  questioning,        proposal         reviewed and
                                  response-hesitation requirements     edited the
                                  analysis,           before being     literature
                                  knowledge-gap       included.        discussion, and
                                  identification,                      made the final
                                  communication                        decisions on
                                  difficulties, and                    which evidence
                                  AI-supported                         and technical
                                  assessment. Also                     approaches to
                                  assisted with                        use.
                                  literature
                                  comparison and
                                  proposal wording.
                             TABLE 9 AI USE DISCLOSURE TABLE




                                                                                      42
```

---

# Part III, Image-only PDF content: visual transcription

This part records content visible inside embedded images that the PDF text extractor does not capture. It is **separate from the verbatim text-layer blocks**. Line wrapping and arrangement are represented in Markdown. Diagram edges and schedule periods are transcribed from the images; ambiguous visual labels are identified rather than guessed. The PDF remains authoritative for original image appearance and signatures.

## A. Declaration, physical PDF page 2 / printed page 1

The embedded declaration reads:

> DECLARATION
>
> I declare that this is my own work, and this proposal does not knowingly incorporate any material previously submitted for a degree or diploma at any other university or higher education institution, nor does it contain any material that has been previously published or written by another person apart from where proper acknowledgment is given in the text.

| Name | Student ID | Signature |
| --- | --- | --- |
| R. J. Vanderheyden | IT23212022 | Handwritten signature present; not reproduced as text |

> The above candidate is conducting research for their undergraduate Dissertation under my supervision

| Name | Date | Signature |
| --- | --- | --- |
| Prof. Nathali Silva | Handwritten date appears as 14/09/2026 | Handwritten signature present; not reproduced as text |

## B. Figure 1, high-level AdaptLearn architecture

Location: physical PDF page 24 / printed page 23.

Caption: **FIGURE 1 HIGH-LEVEL ADAPTLEARN SYSTEM ARCHITECTURE WITH C04 HIGHLIGHTED**.

### Node text

| Node | Visible text |
| --- | --- |
| Learner | Student / Learner |
| Platform | AdaptLearn Learning Platform |
| Highlighted component | C04 / Intelligent Viva System / Technical Viva Assessment & Feedback |
| Group containing C01–C03 | AdaptLearn Intelligent Learning Components |
| C01 | Adaptive Curriculum Engine / Learning Path & Mastery |
| C02 | Cognitive Load Detection / Learner-State Information |
| C03 | AI Tutoring & Explanation / Course-Grounded Support |

The learner connects to the platform; the platform links to the learning components. C04 is emphasized separately. Visible exchange labels include **Topic & Mastery**, **Review Notification**, **Viva Feedback**, and **Course Content**. The learner-state/review-recommendation labels overlap in the rendered diagram and should not be treated as a single combined label. Section 4.3 and Table 3 explicitly define their intended exchanges:

- C01 → C04: topic and mastery information.
- C04 → C01: review notification.
- C02 → C04: cognitive-load/learner-state context.
- C03 → C04: course content.
- C04 → C03: recommend review material after the viva.
- C04 provides viva feedback through the platform.

## C. Figure 2, Intelligent Viva System internal architecture

Location: physical PDF page 26 / printed page 25.

Caption: **FIGURE 2 INTELLIGENT VIVA SYSTEM INTERNAL ARCHITECTURE**.

### Node labels

1. Structured Question Bank, Questions, Reference Answers, Rubrics, Misconceptions and Follow-up Paths
2. Topic / Concept Selection
3. Structured Viva Question Delivery
4. Student Response Capture
5. Speech-to-Text Processing
6. Answer Assessment, Reference Answer and Rubric Comparison
7. Answer-State Classification
8. Deterministic Follow-up Policy
9. AI-Assisted Natural Phrasing / Rephrasing
10. Response-Hesitation Analysis, Pauses, Latency, Fillers, Hedging and Restarts
11. Gap-Differentiation Mechanism
12. Mixed / Insufficient Evidence
13. Likely Communication Difficulty
14. Likely Knowledge Gap
15. General Viva Feedback
16. Communication-Improvement Guidance
17. Recommend Relevant Review Material
18. Post-Viva Feedback Report

### Connections transcribed from the figure

| From | Edge label, if shown | To |
| --- | --- | --- |
| Structured Question Bank |, | Structured Viva Question Delivery |
| Topic / Concept Selection |, | Structured Viva Question Delivery |
| Structured Viva Question Delivery |, | Student Response Capture |
| Student Response Capture | Speech | Speech-to-Text Processing |
| Speech-to-Text Processing |, | Answer Assessment |
| Student Response Capture | Text | Answer Assessment |
| Student Response Capture |, | Response-Hesitation Analysis |
| Answer Assessment |, | Answer-State Classification |
| Answer-State Classification |, | Deterministic Follow-up Policy |
| Deterministic Follow-up Policy | Follow-up Required | AI-Assisted Natural Phrasing / Rephrasing |
| AI-Assisted Natural Phrasing / Rephrasing |, | Structured Viva Question Delivery |
| Deterministic Follow-up Policy | Assessment Complete | Gap-Differentiation Mechanism |
| Answer Assessment |, | Gap-Differentiation Mechanism |
| Answer-State Classification |, | Gap-Differentiation Mechanism |
| Response-Hesitation Analysis |, | Gap-Differentiation Mechanism |
| Gap-Differentiation Mechanism |, | Mixed / Insufficient Evidence |
| Gap-Differentiation Mechanism |, | Likely Communication Difficulty |
| Gap-Differentiation Mechanism |, | Likely Knowledge Gap |
| Mixed / Insufficient Evidence |, | General Viva Feedback |
| Likely Communication Difficulty |, | Communication-Improvement Guidance |
| Likely Knowledge Gap |, | Recommend Relevant Review Material |
| General Viva Feedback |, | Post-Viva Feedback Report |
| Communication-Improvement Guidance |, | Post-Viva Feedback Report |
| Recommend Relevant Review Material |, | Post-Viva Feedback Report |

## D. Figure 3, Work Breakdown Structure

Location: physical PDF page 35 / printed page 34.

Image heading: **AdaptLearn – Intelligent Viva System | Work Breakdown Structure**.

Subtitle: **Individual Component: C04 – Intelligent Viva System**.

Root: **1.0 Intelligent Viva System**.

| Branch | Work items |
| --- | --- |
| 1.1 Literature and Planning | 1.1.1 Literature review; 1.1.2 Research gap refinement; 1.1.3 Methodology planning |
| 1.2 Requirements and Design | 1.2.1 User requirements; 1.2.2 High-level architecture; 1.2.3 Question bank design; 1.2.4 Rubrics and misconceptions |
| 1.3 Core Development | 1.3.1 Viva interface; 1.3.2 Speech / text response capture; 1.3.3 Answer assessment; 1.3.4 Answer-state classification; 1.3.5 Deterministic follow-up policy; 1.3.6 Response-hesitation analysis; 1.3.7 Gap differentiation; 1.3.8 Feedback and reporting |
| 1.4 Testing and Integration | 1.4.1 Pilot testing; 1.4.2 Bug fixing and refinement; 1.4.3 Integration with C01, C02, and C03 |
| 1.5 Evaluation and Analysis | 1.5.1 Participant evaluation; 1.5.2 Human-rater comparison; 1.5.3 Results analysis |
| 1.6 Documentation | 1.6.1 Progress documentation; 1.6.2 Final report writing; 1.6.3 Presentation preparation |

Footer: **Component Responsibility: C04 Member**.

Caption: **FIGURE 3 WORK BREAKDOWN STRUCTURE**.

## E. Figure 4, Gantt Chart

Location: physical PDF page 36 / printed page 35.

Image title: **AdaptLearn – Intelligent Viva System | Gantt Chart**.

Columns run from **March 2026 through June 2027**. The table below translates the months covered by the image's black bars; these are planned periods, not verified completion dates or day-level deadlines.

| Group | Activity / Milestone | Planned bar period |
| --- | --- | --- |
| Research & Proposal Phase | Project Formation | March 2026 |
| Research & Proposal Phase | Topic Selection & Research Planning | April–May 2026 |
| Research & Proposal Phase | Literature Review & Research Gap Refinement | March–April 2026 |
| Research & Proposal Phase | Requirements Analysis | May–June 2026 |
| Research & Proposal Phase | Supervisor Selection & Research Direction | May 2026 |
| Research & Proposal Phase | TAF Submission & Evaluation | June–July 2026 |
| Research & Proposal Phase | Ethics Preparation & Study Planning | April–May 2026 |
| Research & Proposal Phase | User Requirements, Architecture & Question-Bank Design | May–June 2026 |
| Research & Proposal Phase | Proposal Development & Presentation | August–September 2026 |
| Research & Proposal Phase | Proposal Report Submission | September 2026 |
| Research & Proposal Phase | Status Document / Logbook | October 2026–June 2027 |
| C04 – Intelligent Viva System Development & Evaluation | Viva Interface & Response Capture | May–June 2026 |
| C04 – Intelligent Viva System Development & Evaluation | Answer Assessment & Classification | June–July 2026 |
| C04 – Intelligent Viva System Development & Evaluation | Deterministic Follow-up Policy | July–August 2026 |
| C04 – Intelligent Viva System Development & Evaluation | Data Preparation & Pilot Dataset Collection | July–August 2026 |
| C04 – Intelligent Viva System Development & Evaluation | Response-Hesitation Analysis | August–September 2026 |
| C04 – Intelligent Viva System Development & Evaluation | Gap-Differentiation Mechanism | August–September 2026 |
| C04 – Intelligent Viva System Development & Evaluation | Pilot Testing & Prototype Refinement | August–September 2026 |
| C04 – Intelligent Viva System Development & Evaluation | Integration with C01, C02 & C03 | September–October 2026 |
| C04 – Intelligent Viva System Development & Evaluation | Human-Rater Validation & Experimental Evaluation | October 2026–March 2027 |
| C04 – Intelligent Viva System Development & Evaluation | End-to-End Testing | February–April 2027 |
| C04 – Intelligent Viva System Development & Evaluation | Results & Performance Analysis | March–May 2027 |
| C04 – Intelligent Viva System Development & Evaluation | Research Paper Preparation | April–May 2027 |
| C04 – Intelligent Viva System Development & Evaluation | Final Report Preparation | May–June 2027 |
| C04 – Intelligent Viva System Development & Evaluation | Deployment / Demo Preparation | May–June 2027 |
| C04 – Intelligent Viva System Development & Evaluation | Final Presentation | June 2027 |

Image footnote: **Black bar = planned activity period. Future dates are a proposed continuation and can be aligned to the official RP calendar.**

Caption: **FIGURE 4 GANTT CHART**.

## F. Appendix 1, survey chart transcriptions

Locations: physical PDF pages 39–41 / printed pages 38–40.

The PDF's “AdaptLearn Survey” hyperlink targets:

<https://docs.google.com/forms/d/e/1FAIpQLSdyUCxYLXWEKKv0_YeOLZDfC8YVYUJPpkvySI4NyIXi6VkpuQ/viewform?usp=publish-editor>

The link was extracted from the PDF; the live form was not consulted to change the report's results.

### Q1: Have you ever understood a topic but found it difficult to explain it verbally?

Chart header: **24 responses**.

| Legend category | Percentage visibly printed |
| --- | --- |
| Frequently | 20.8% |
| Sometimes | 58.3% |
| Rarely | 20.8% |
| Never | No percentage label or visible slice |

### Q2: How often do you practice explaining technical concepts verbally?

Chart header: **24 responses**.

| Legend category | Percentage visibly printed |
| --- | --- |
| Never | Small blue slice; no percentage label printed |
| Rarely | 37.5% |
| Sometimes | 41.7% |
| Frequently | 16.7% |

### Q3: Would an AI-based viva conversation help you confirm your understanding?

Chart header: **24 responses**.

| Legend category | Percentage visibly printed |
| --- | --- |
| Not helpful at all | No percentage label or visible slice |
| Slightly helpful | 20.8% |
| Moderately helpful | 33.3% |
| Very helpful | 29.2% |
| Extremely helpful | 16.7% |

### Q4: Which benefits would you expect from an Intelligent viva system?

Chart header: **24 responses**.

| Category | Displayed count | Displayed percentage |
| --- | --- | --- |
| Confirm true understanding | 13 | 54.2% |
| Identify missing knowledge | 18 | 75% |
| Improve technical explanation skills | 18 | 75% |
| Prepare for interviews | 17 | 70.8% |
| Prepare for university vivas | 13 | 54.2% |
| Reduce presentation anxiety | 12 | 50% |

### Q5: Would follow-up questions help you explain your understanding better?

Chart header: **19 responses**.

| Category | Displayed count | Displayed percentage |
| --- | --- | --- |
| Not helpful at all | 2 | 10.5% |
| Slightly helpful | 3 | 15.8% |
| Moderately helpful | 9 | 47.4% |
| Very helpful | 13 | 68.4% |
| Extremely helpful | 2 | 10.5% |

### Q6: What feedback would help you most after answering technical questions?

Chart header: **19 responses**.

| Category | Displayed count | Displayed percentage |
| --- | --- | --- |
| Missing knowledge | 6 | 31.6% |
| Weak points in my answer | 13 | 68.4% |
| Communication tips | 14 | 73.7% |
| Topics to review | 10 | 52.6% |
| Overall performance | 9 | 47.4% |

### Q7: How comfortable are you with pauses and response delays being used as supporting information?

Chart header: **19 responses**.

| Category | Displayed count | Displayed percentage |
| --- | --- | --- |
| Very uncomfortable | 1 | 5.3% |
| Uncomfortable | 3 | 15.8% |
| Neutral | 11 | 57.9% |
| Comfortable | 7 | 36.8% |
| Very comfortable | 3 | 15.8% |

Transcription note: Values above deliberately preserve the charts as shown. Some bar-chart category counts total more than the chart's response count. The PDF does not provide the raw response data or establish the question-selection settings here, so do not silently reinterpret or “correct” these numbers. The printed pie percentages may also have rounding differences.

---

## Handover completion checklist

- All 43 physical PDF pages' extractable text included in order.
- Cover, declaration, abstract, acknowledgements, contents/lists, introduction/literature/research gap, objectives, methodology, architecture/integration/boundaries, FR/NFRs, commercialization, budget, WBS, schedule, all 18 references, and appendices retained.
- Every PDF page containing an embedded image inspected: declaration, four figures, and seven survey charts.
- Image-only labels, chart values and schedule content separately transcribed without silently altering the source.
- Later user preferences separated from the proposal.
- Existing demo source and historical verification distinguished from live configuration and research validation.
- No claims that a real Gemini call, Neon connection, full speech pipeline, or final participant study has been completed.
- No source-code changes were made while preparing this handover.

**End of handover. Continue from the user's next request.**
