> Historical document supplied in the input ZIP. The current user-requested course/upload scope and verification are documented in [UPGRADE.md](UPGRADE.md) and [VERIFICATION_UPGRADE.md](VERIFICATION_UPGRADE.md); they supersede conflicting statements below.

# AdaptLearn C4 implementation contract

This is a research prototype implementing the attached proposal and specification, with a runnable local mode. It is source for an existing multi-component project, not a hosted replacement stack. Preserve `backend/services/viva-service` and `features/viva`. React + TypeScript + Tailwind frontend; Python FastAPI + SQLAlchemy backend; SQLite locally, Neon PostgreSQL through `DATABASE_URL`. C01/C02/C03 are replaceable mock integrations. No real Neon credentials or real LLM service credentials have been supplied.

## Shared conventions

Base URL `/api/v1`. Vite proxies `/api` to `http://127.0.0.1:8000`. JSON uses snake_case. IDs are strings. Lists are `{items: [...]}` unless specified. Errors use FastAPI `{detail: string}`. Time is ISO UTC. Assessment enums: `complete`, `partial`, `superficial`, `incorrect`, `misconception_bearing`, `non_answer`. Gap enums: `LIKELY_KNOWLEDGE_GAP`, `LIKELY_COMMUNICATION_DIFFICULTY`, `MIXED_INSUFFICIENT_EVIDENCE`.

Auth uses `Authorization: Bearer <token>`. Participant registration creates a fresh identity/token (a participant code alone must never grant access to someone else's history). Admin/evaluator use separate server-configured access keys exchanged for tokens. Tokens persisted hashed and with expiry. DEV_MODE permits documented local-only demo keys; reject missing/default keys in non-dev mode. The server returns role capabilities; do not hide controls as the only authorization enforcement. Admins can approve questions; evaluators rate blinded evidence without system predictions. Auth response `{token, user:{id, participant_code, role}}`, role `participant|admin|evaluator`.

## Endpoints and response shapes

- GET `/health`: `{status, database, assessment_provider, speech_provider, integration_mode, demo_mode}`.
- POST `/auth/participant`: `{participant_code, consent: true}` -> auth response. Use pseudonyms, not names/emails.
- POST `/auth/staff`: `{access_key, role: 'admin'|'evaluator'}` -> auth response.
- GET `/auth/me` -> `{user:{id,participant_code,role}}`.
- GET `/topics` -> `{items:[{id,name,course_id,description,question_count}]}`. Suggested IDs `stacks`, `queues`, `oop`, `databases`.
- GET `/integrations/context?topic_id=stacks` -> `{c01:{topic,mastery,confidence,starting_difficulty,source}, c02:{cognitive_load,frustration,engagement,source}, c03:{course_id,topic,chunks:[{text,source,page}],review_resources:[{title,resource_id,url?}],source}}`. Mock values clearly marked, no outgoing message claimed delivered when mocked. 0..100 mastery/confidence.
- GET `/knowledge-check?topic_id=stacks` -> `{items:[{id,prompt,options:[string]}]}` with no correct answer disclosed.
- POST `/knowledge-check`: `{topic_id,answers:[{question_id,selected_index}]}` -> `{id,score,total,percentage}`.
- POST `/sessions`: `{topic_id,input_mode:'text'|'speech',max_depth:2,knowledge_check_id?:string}` -> Session.
- GET `/sessions` -> `{items:[SessionSummary]}` owned participant sessions only (staff may receive authorized scope); summary `{id,topic_id,topic,status,created_at,completed_at?,turn_count,outcome?}`.
- GET `/sessions/{id}` -> Session.
- POST `/sessions/{id}/answers`: `{question_id,transcript,input_mode:'text'|'speech',response_latency_ms?:number,audio_metrics?:{pause_count,total_pause_ms,average_pause_ms,audio_duration_ms},request_id:string}` -> `{session:Session,assessment:Assessment,action:string}`. Idempotency request_id; stale question or completed session returns 409, no duplicate turns. Ignore client-supplied classifier labels. Cap input lengths. No rubric/model-answer leakage to participant before completion. Acoustic metrics typed input null, never fabricated zeros.
- POST `/sessions/{id}/finish`: `{}` -> Report. Allow early end with insufficient evidence where appropriate.
- GET `/sessions/{id}/report` -> Report for completed sessions only.
- GET `/sessions/{id}/export` -> JSON download with audit trail, no credentials and only authorized ownership. Frontend may download Report itself as JSON and print it as PDF using browser printing.
- POST `/speech/transcribe`: multipart `audio` -> `{transcript,segments:[{start,end,text}],metrics:{pause_count,total_pause_ms,average_pause_ms,audio_duration_ms},provider}`. Genuine faster-whisper optional; meaningful 503 if not installed/configured, typed fallback. Do not pretend browser transcription measured audio timings. Limit file size, validate type, cleanup temporary audio. No cloud audio without opt-in configuration.
- GET `/bank?status=all&topic_id=stacks` -> `{items:[BankQuestion]}` staff-only.
- POST `/bank/generate`: `{topic_id,count:2}` -> `{items:[BankQuestion],provider}`. LLM provider generated questions remain drafts; source references required. Explicit `demo` provider may generate documented sample templates, marked as demo; never silently call heuristic output an LLM. Use C03 chunks and review source metadata.
- PUT `/bank/{id}`: fields matching BankQuestion -> BankQuestion, admin only, editing an approved bank item creates a draft revision or invalidates approval while existing session snapshots remain immutable.
- POST `/bank/{id}/review`: `{status:'approved'|'rejected'|'draft',review_notes?:string}` -> BankQuestion, admin only.
- GET `/evaluation/cases?condition=A|B|C` -> `{items:[{case_id,session_id,topic,concept,condition,knowledge_check?,turns:[{id,question,transcript,depth,input_mode,hesitation?}],my_rating?:{answer_state,gap_outcome,follow_up_appropriateness?,feedback_usefulness?,notes?}}]}`. Research staff only. A exposes initial answer only, B adds followups, C adds hesitation; never system assessments/actions/outcomes to raters. Knowledge checks if used should be constant across compared conditions, clearly documented.
- POST `/evaluation/ratings`: `{case_id,condition:'A'|'B'|'C',answer_state,gap_outcome,follow_up_appropriateness?:1..5,feedback_usefulness?:1..5,notes?:string}` -> `{id}`. Rater identity from token. Case_id stable concept/session ID. Upsert unique per rater/case/condition.
- GET `/evaluation/metrics` -> `{conditions:[{condition,n,answer_accuracy,answer_macro_f1,answer_kappa,gap_accuracy,gap_macro_f1,gap_kappa}],inter_rater?:{n,kappa},follow_up_appropriateness?:number,feedback_usefulness?:number,notes:[string]}`. Null metrics for insufficient pairs. Compute true evidence ablations, not identical predictions merely relabeled A/B/C. Rater disagreements reported; no invented results.
- GET `/evaluation/export` -> research JSON download of anonymized authorized rows, separately from blind rating endpoint.

## Core types

`QuestionView = {id,concept,question,depth,ordinal,total_concepts}`. Never include reference answer/rubric in participant current question.

`Assessment = {state,coverage:number /*0..100*/,rubric_hits:[{id,point,covered}],missing_points:[string],misconceptions:[string],reason,provider}`. During active session return a safe summary if full rubric reveals answer; frontend can show state/progress without answer hints. Store complete assessment privately.

`Session = {id,topic_id,topic,status:'active'|'completed',input_mode,max_depth,created_at,completed_at?,current_question:QuestionView|null,turns:[{id,question_id,question,transcript,state,coverage,depth,action,input_mode,hesitation?,created_at}],integration_context:Context,progress:{completed_concepts,total_concepts},report?:Report}`. Current question_id must be unique per issued question including followups. Save before returning. Snapshot approved question content and provider/policy versions per session.

`Report = {session_id,topic,created_at,outcome,explanation,rubric_coverage:number,strengths:[string],missing_concepts:[string],concepts:[{concept,outcome,explanation,initial_state,final_state,rubric_coverage,turn_count}],hesitation:{available:boolean,response_latency_ms?:number,pause_count?:number,total_pause_ms?:number,filler_count?:number,fillers_per_100_words?:number,hedge_count?:number,restart_count?:number,notes:[string]},improvement_plan:[string],review_resources:[{title,resource_id,url?}],mastery_mismatch:boolean,integration_events:[{component,event,status,detail}],evidence_conditions:[{condition,outcome,explanation}],limitations:[string]}`. Signals supplementary; never infer knowledge or confidence solely from hesitation, and weak-to-good answers after revealing scaffolds are not sufficient proof of pre-existing knowledge. Depth exhaustion, short circuits, typed modality and early finish support insufficient evidence.

`BankQuestion = {id,topic_id,concept,question,reference_answer,rubric_points:[{id,point,keywords:[string]}],misconceptions:[{id,description,keywords:[string]}],follow_ups:{partial,superficial,incorrect,misconception_bearing,non_answer},sources:[{source,page?,text?}],status:'draft'|'approved'|'rejected',origin,review_notes?,version:number}`. Main/followup assessment rubrics should fit question purpose; do not require facts absent from rubric. Model output validated Pydantic with strict allowed enums.

## Required logic, providers, and UI

Deterministic actions: complete NEXT_CONCEPT; partial PROBE_MISSING_RUBRIC; superficial ASK_REASONING_OR_EXAMPLE; misconception_bearing PROBE_MISCONCEPTION; incorrect ASK_SIMPLER_OR_PREREQUISITE; non_answer REPHRASE then SIMPLIFY. Bound depth, prevent repeated same prompt loops, audit question selection. Followups must not smuggle missing main-answer criteria; assess followup in context.

Transparent local demo assessor for immediate use, plus one configurable JSON-schema LLM interface for Ollama and OpenAI-compatible API. Explicit provider badges/limitations. Optional sentence-transformers helper and real faster-whisper support. Missing provider produces an honest error or explicitly logged configured fallback. No paid API required. No fake success for unavailable models, Neon, integrations, or metrics. Use 8+ meaningful seeded demo questions across 4 topics, with 2 per topic plus followups. Only approved questions start sessions; demo seeded approval is identified as demo content, not falsely expert-reviewed. C03 owns material; C04 has no lecture upload flow/vector database.

Frontend workspace: calm blue/white/navy academic product with sidebar and useful first-screen session controls. Views: Viva workspace with small integration cards, live session with auto TTS/user gesture and typed/mic mode, session history/reports, bank generate/edit/review for admin, blinded research/evaluator panel plus metrics. Separate student/admin/evaluator role sign-in. Distinguish sample integration data and demo assessment openly without overwhelming the product. Capture TTS end -> actual first voice timing via browser audio activity when possible; if unknown use null, never elapsed typing time as speech latency. VAD/pause metrics from server or honest signal-amplitude estimate labeled estimate. Do not automatically submit transcriptions; user reviews transcription. Microphone permissions errors and unavailable STT fallback. Stop TTS before recording, release tracks and audio contexts, support keyboard, accessible labels, responsive screens, print-friendly final report, JSON export.

Backend tests prioritize six answer states, deterministic depth/rephrase handling, ownership/role protection, approved bank only, immutable snapshots, idempotent answers, unfinished/mixed outcomes, ablation evidence separation, blind ratings, persisted restart behavior. Root integrator will install/run and smoke-test UI. Document prototype limits and real study validation required; do not claim measured research accuracy before collecting raters.
