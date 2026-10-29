# C4 Intelligent Viva System: the complete study guide

For R. J. Vanderheyden (IT23212022), to read before PP1 on 21 Oct 2026. Every number here
comes from `Research Data/Recordings/results/report.md`, the code (gap rules
`c04-gap-1.10-pilot-signals-only`) or the checks run on 17 to 20 Oct. Shorter companion:
[VIVA-EXPLAINED.md](VIVA-EXPLAINED.md).

---

## 0. The one-minute version

> In a spoken viva, a weak answer is usually read as "the student does not know". For a Sri
> Lankan student answering in English, their second language, a weak answer can also mean "the
> student knows it but could not say it". These need different help, and confusing them is
> unfair. C4 is an AI viva examiner that asks technical questions out loud, listens to the
> spoken answer, marks it against a rubric, asks follow-ups that never teach, and then decides
> per topic whether the evidence points to a **likely knowledge gap** or a **likely
> communication difficulty**. The speech side of that decision uses thresholds I derived from my
> own pilot study of 10 students whose knowledge was controlled with a quiz.

Two parts, one idea:

| Part | What it is | Status |
|---|---|---|
| **Research** | A pilot study: which speech measures separate students who find English vivas hard from those who do not, and at what thresholds | Done: 10 students, results in `report.md` |
| **System** | The live viva (student side, lecturer side, reports) that uses those thresholds | Working; PP2 tests it on new students |

---

## 1. My component

- **Name:** C4, Intelligent Viva System, part of AdaptLearn (project J26-IT-360).
- **Owner:** me. C1 to C3 belong to teammates; C4 uses them as integrations (mocked for PP1).
- **One sentence:** an AI viva that tells a likely knowledge gap from a likely communication
  difficulty in L2 English technical vivas, using rubric marking, non-teaching follow-ups and
  speech fluency thresholds derived from pilot data.

## 2. The problem it solves

1. **Vivas confuse two different problems.** A short, hesitant answer looks the same whether the
   student lacks the knowledge or lacks the words. Examiners judge mostly by what comes out.
2. **This hits L2 students hardest.** Most SLIIT students answer in English as a second language
   (Sinhala or Tamil first). Pausing, searching for words and restarting are normal in L2 speech.
3. **The two need different help.** A knowledge gap needs revision; a communication difficulty
   needs speaking practice and a fairer judgement of what the student knows.
4. **Human vivas do not scale and are inconsistent.** Follow-ups vary by examiner and can
   accidentally teach the answer, which hides what the student knew before.
5. **Fillers alone are not enough.** Counting "um" is the obvious idea, but transcribers drop
   fillers, and fluent speakers use them too. Speed and pauses separated my groups better.

## 3. How it solves it

1. **Controls knowledge.** In the study, a quiz made sure both groups knew the material (median
   9 of 10 in both). In the live viva, the rubric coverage after follow-ups that never teach is
   the evidence of knowledge.
2. **Measures speech.** Speed (speech rate, articulation rate), pausing (mean pause, pauses per
   minute), runs between pauses, fillers and repairs, measured from the student's own voice.
3. **Derives thresholds from data.** The cut-offs that best separated my two groups (Youden J),
   checked with leave-one-out accuracy, compared with thresholds from the literature.
4. **Uses them live.** Each spoken answer is checked against those cut-offs (three signals: speed and pauses, fillers, repeats and restarts).
5. **Decides with fixed rules, not AI.** The AI marks content and words follow-ups; the
   knowledge-versus-communication decision is a fixed, versioned rule set, so it is explainable
   and repeatable.
6. **Reports supportively.** "Likely", never a diagnosis; a study plan for knowledge gaps and a
   speaking plan for speaking difficulty; the lecturer sees the evidence.

## 4. Stakeholders

| Stakeholder | Interest |
|---|---|
| **Students** (SLIIT undergraduates, L2 English) | Fair judgement of what they know; practice; clear feedback |
| **Lecturers / viva examiners** | Consistent vivas, evidence for each judgement, less time |
| **Module coordinators, quality assurance** | Fairer, standardised oral assessment |
| **AdaptLearn team (C1 to C3)** | C1 topic mastery and C2 cognitive load feed C4; C3 supplies course content and questions; review flags back to the platform are planned for PP2 |
| **Supervisor and researchers** | A data-derived method for L2 communication difficulty |
| **University ethics** | Consent, privacy, no audio stored, codes not names |

AdaptLearn integrations (mocked in PP1, shown as "AdaptLearn context · simulated"):

- **C1 topic mastery:** reference evidence only (decision: it never decides the result).
- **C2 cognitive load:** high load gives a shorter viva (at most 2 questions, 1 follow-up each).
- **C3 content:** the live question bank is the C3 catalogue (10 courses, IT1010 Programming
  Fundamentals among them).

## 5. Process and technology

### Technology

| Layer | Technology |
|---|---|
| Frontend | React, TypeScript, Vite; 3D examiner with TalkingHead and three.js |
| Backend | Python 3.11, FastAPI, SQLAlchemy, `uv` |
| Database | PostgreSQL on Neon (cloud) |
| Speech to text | Groq Whisper `whisper-large-v3-turbo`, prompted to keep fillers and to expect course words; laptop fallback `faster-whisper` |
| Pauses and speaking time | Silero VAD (voice activity detection, via `faster-whisper`); audio decoded with PyAV |
| Fluency measures, fillers, repairs | My own code: `app/domain/fluency.py`, `app/domain/disfluency.py` |
| Marking and follow-up wording | Groq `openai/gpt-oss-120b` (backup `gpt-oss-20b`, then Google Gemini) |
| Examiner voice | Groq Orpheus (`canopylabs/orpheus-v1-english`, voice diana) |
| Decisions | Fixed rules in `app/domain/logic.py` (gap rules 1.8) |
| Research tools | Zoom (separate audio per person), CrisperWhisper on Google Colab (verbatim transcripts with fillers), Praat/Parselmouth (syllables), Audacity (counting check), Python statistics script `run_stats.py` |

### One viva, step by step

1. The student signs in with a participant code and consents (answers and timing are saved for
   the lecturer).
2. The student picks a topic and answer mode (speak or type).
3. The examiner voice reads the main question; the 3D examiner lip-syncs.
4. The student records an answer. The browser sends the audio and the topic.
5. Backend: Silero VAD finds speech and pauses; Groq Whisper transcribes (only up to 0.6 s after
   the last word, so it cannot invent an ending); the fluency measures are computed.
6. The student sees the transcript without "um" and "uh", may correct misheard words, and sends.
7. Backend: fillers, repeats and hedges are counted from what was actually heard; the AI marks
   each rubric point; the three signals are checked.
8. Fixed rules choose the next step (follow-up, plainer re-ask, simpler question or next topic).
   The AI words the follow-up, quoting the student's own words.
9. At the end, the gap rules decide each topic and the whole viva; the report is built.
10. Audio is discarded. Transcripts, numbers and rule versions are saved.

---

## 6. The research: data collection, analysis, validation

### Research question

When knowledge is controlled, which speech measures separate Sri Lankan students who have
communication difficulty in English technical vivas from those who do not, and at what
thresholds? (Supervisor's framing: is there a gap in technical communication for students with
English as a second language? The pilot answers yes: with equal knowledge, the difficulty group
spoke measurably slower and paused more; the thresholds then detect it.)

**Hypothesis H1:** students in the difficulty group speak more slowly, in shorter runs, with
longer and more frequent silent pauses: speech rate, mean length of run, mean silent pause and
silent pauses per minute differ between the groups. These four were fixed before seeing the data.

### Data collection, step by step

1. **Ethics:** preliminary ethics form submitted (11 Oct); consent in the Google Form before any
   recording. Codes only (P01 to P10), no names or emails collected.
2. **Recruitment:** 10 students who completed IT1010.
3. **Google Form:** background (code, year, IT1010 done, first language, spoken English 1 to 5),
   three statements (1 to 5), and a 10-question MCQ:
   - "In vivas I often stop or say 'um' while searching for English words."
   - "Even when I know a technical answer, I find it hard to explain it in English."
   - "In vivas I lose marks because I cannot express what I know."
4. **Grouping:** average of the three statements: 3.5 or more = difficulty group, 2.5 or less =
   comfortable group. MCQ 7 of 10 or more, so weak answers are not knowledge gaps.
5. **The viva:** 10 minutes on Zoom, run by me from a fixed script: a warm-up, then 5 IT1010
   questions (variables and data types, conditionals, loops, functions and parameters, return
   values and printing), one scripted follow-up each (B for partly correct, C for wrong or
   "I don't know"), no help while the student speaks except "Take your time". An observer rated
   each answer.
6. **Recording:** Zoom saved each voice in its own file (`P0X_student.m4a`,
   `P0X_examiner.m4a`), so my voice never mixes with the student's. P00 was a practice run,
   excluded.
7. **Transcription:** CrisperWhisper on Google Colab, a verbatim Whisper that writes every
   "um" and "uh" with word times.
8. **Measurement:** `analyze_recordings.py` splits each session per question using my track, so
   listening and thinking time is not counted as the student's pauses, then measures the
   student's speech.
9. **Counting check (accuracy):** for one minute per student I counted fillers and repairs by
   ear and pauses of 1 s or more in Audacity, and compared with the tool.
10. **Statistics:** `run_stats.py` wrote `report.md`, `summary.csv` and one chart per measure.

### What was measured (14 measures)

| Measure | Meaning | Dimension |
|---|---|---|
| Speech rate (syllables/s) | Syllables over total speaking time, pauses included | Speed |
| Articulation rate (syllables/s) | Syllables over time actually speaking, pauses excluded | Speed |
| Mean length of run (syllables) | Average syllables between silent pauses | Speed and breakdown |
| Mean silent pause (ms) | Average silent pause of 250 ms or more | Breakdown |
| Silent pauses per minute | How often the student stops | Breakdown |
| Pauses of 1 s or more per minute | Long stops | Breakdown |
| Share of pauses inside clauses | Pauses in the middle of a sentence (exploratory: commas follow pauses) | Breakdown |
| Filled pauses per minute / per 100 words | um, uh, er, hmm | Breakdown |
| Repairs per minute | Repeats ("the the"), false starts ("func-"), self-corrections ("sorry, I mean") | Repair |
| Lexical fillers per minute | "you know", "kind of" | Repair |
| Word searches | "how do I say" | Repair |
| Response latency (s) | Silence before the first word | Timing |
| Phonation time ratio | Share of time spent speaking | Speed |

Definitions follow the L2 fluency literature: silent pauses of 250 ms or more (De Jong and
Bosker, 2013); speed, breakdown and repair fluency (Tavakoli and Skehan, 2005); pauses of 1 s
or more (Foster and Skehan, 1996).

### How it was analysed

| Method | Why |
|---|---|
| **Mann-Whitney U test** | Compares two small groups without assuming normal data |
| **Holm correction** on the 4 primary measures | Controls false positives from testing several measures |
| **AUC** | The chance a random difficulty student is on the expected side of a random comfortable student (0.5 = none, 1.0 = perfect) |
| **Youden J best cut-off** | The threshold that sorts the most students correctly |
| **Leave-one-out accuracy** | Each student classified by a cut-off set on the other nine: the honest estimate for new students |
| **Literature comparison** | Thresholds from published L2 data, to see whether my own data does better |

### Results

Knowledge was equal: MCQ median 9 in both groups (p = 1.000).

| Measure | Difficulty | Comfortable | p | p (Holm) | AUC |
|---|---|---|---|---|---|
| **Speech rate** (primary) | 1.91 | 3.64 | 0.008 | 0.032 | 1.00 |
| **Mean length of run** (primary) | 4.45 | 12.25 | 0.008 | 0.032 | 1.00 |
| **Mean silent pause, ms** (primary) | 908 | 528 | 0.032 | 0.032 | 0.92 |
| **Silent pauses per minute** (primary) | 24.18 | 13.86 | 0.016 | 0.032 | 0.96 |
| Articulation rate | 2.75 | 4.34 | 0.008 | n/a | 1.00 |
| Pauses of 1 s or more per minute | 8.06 | 1.36 | 0.032 | n/a | 0.92 |
| Filled pauses per 100 words | 14.58 | 1.47 | 0.016 | n/a | 0.96 |
| Filled pauses per minute | 11.25 | 2.13 | 0.056 | n/a | 0.88 |
| Phonation time ratio | 0.63 | 0.84 | 0.032 | n/a | 0.92 |
| Response latency, s | 3.84 | 2.62 | 0.095 | n/a | 0.84 |
| Share of mid-clause pauses | 0.74 | 0.50 | 0.095 | n/a | 0.84 |
| Repairs per minute | 1.24 | 0.00 | 0.139 | n/a | 0.80 |
| Lexical fillers per minute | 0 | 0 | 0.424 | n/a | 0.40 |
| Word searches | 0 | 0 | 1.000 | n/a | 0.50 |

**H1 is supported:** all four primary measures differ after Holm correction.

### Thresholds: literature versus pilot

| Measure | Literature | Lit. accuracy | **Pilot cut-off** | Sens. | Spec. | Leave-one-out |
|---|---|---|---|---|---|---|
| Speech rate | below 1.97 | 0.80 | **below 2.53** | 1.00 | 1.00 | 1.00 |
| Articulation rate | below 2.83 | 0.80 | **below 3.59** | 1.00 | 1.00 | 1.00 |
| Mean length of run | below 3.43 | 0.50 | **below 5.73** | 1.00 | 1.00 | 0.90 |
| Mean silent pause | above 687 ms | 0.80 | **above 682.5 ms** | 1.00 | 0.80 | 0.70 |
| Filled pauses per 100 words | none | | **5.42 or more** | 1.00 | 0.80 | 0.80 |
| Repairs per minute | none | | **0.34 or more** | 1.00 | 0.60 | 0.70 |

The literature profile (2 of 4 measures beyond its thresholds) caught 3 of 5 difficulty
students and flagged 0 of 5 comfortable ones. The pilot profile sorted all 10 correctly. The
literature values come from 61 Chinese learners of English giving IELTS-style monologues (one
standard deviation worse than the B1 to B2 mean), a different language and task, which is why
my own thresholds do better.

### Why these 4 measures in the live viva

The live "speed and pauses" signal uses **speech rate, articulation rate, mean length of run and
mean silent pause**, with the pilot cut-offs:

1. **They cover the core fluency dimensions:** speed (speech rate, articulation) and breakdown
   (mean pause), plus mean length of run, which combines both and is one of the strongest
   predictors of perceived fluency in the literature (Kormos and Dénes, 2004).
2. **They are the strongest separators in my data:** AUC 0.92 to 1.00; three of them are
   primary measures significant after correction; articulation rate separated perfectly.
3. **They can be measured live from one answer:** VAD gives the pauses, the transcript gives the
   syllables. Repairs need a verbatim transcript, which the live viva does not have.
4. **The same four have literature thresholds,** so the literature and pilot profiles can be
   compared on equal terms.

**Why "2 of 4" and not 1:** one slow measure can come from a long think or a hard question;
requiring two lowers false alarms. **Why 10 s of speech minimum:** rates over a few seconds are
unstable. **Why timing alone never decides:** slow speech can be a personal style or careful
thinking, so a communication result also needs something heard in the words (fillers, repeats
or restarts).

### Is it accurate? Is it valid?

| Check | Result |
|---|---|
| Tool versus my ears (counting check) | Fillers within 1 for 9 of 10 students (Spearman rho 0.98); repairs 8 of 10 (rho 0.75); pauses of 1 s or more 8 of 10 (rho 0.99) |
| Knowledge controlled | MCQ median 9 and 9, p = 1.000 |
| Pilot cut-offs on unseen students | Leave-one-out accuracy 0.70 to 1.00 per measure |
| Live transcriber versus CrisperWhisper (fillers) | Groq turbo kept 64 of 96 fillers (67%) on 4 pilot students; `whisper-large-v3` kept 61%; local Whisper only 7% (20 of 303). Groq misses mostly sentence-initial "uh" |

**Are 4 measures enough?** Honest answer: a 10-student pilot cannot prove sufficiency. It shows
these are the strongest of 14 measures, with large effects (AUC 0.92 to 1.00). The system does
not rely on them alone: it adds word signals (fillers, repeats and restarts) and requires evidence of
knowledge. PP2 tests the cut-offs on new students, with expert ratings as the reference.

---

## 7. Marking and the answer states

Each rubric point is marked **full** (correct, with the technical term), **partial** (the idea
in everyday words, or part of it; half credit) or **none**. Speech-to-text errors, grammar and
fillers are ignored ("decibel" for "decimal" counts as the term).

**Coverage** = (full points + half the partial points) / all points, as a percentage.

| State | Meaning |
|---|---|
| **complete** | Every point at full |
| **partial** | Some points, or ideas only in everyday words |
| **superficial** (too brief) | Names the idea but does not explain it |
| **incorrect** | Wrong |
| **misconception_bearing** | States a wrong belief as fact (the student's exact words are quoted as evidence) |
| **non_answer** | Nothing about the concept ("I don't know") |

## 8. Follow-up rules (fixed; the AI only words them)

| The answer was | Next step |
|---|---|
| Complete | Next topic |
| Partial | Probe one missing point (its reviewed probe, adapted to the student's words) |
| Superficial | Ask why it works, or for an example in words |
| Misconception | A small concrete case: "what does your idea predict here?" Never says "wrong" |
| Incorrect | A simpler or prerequisite question (counts as help: "scaffolded") |
| "I don't know" | 1st: reassure and ask again in other words; 2nd: a simpler question |
| "I don't understand the question" | The same question in plainer words; not marked, no follow-up used |
| "Skip this question" / "Stop the viva" | Next topic / finish |

Limits: at most 2 follow-ups per topic (1 under high C2 load). Follow-ups quote the student's
words, never reveal the answer, never repeat an earlier follow-up, and quote the intended term
when a word was misheard ("float", not "bloat"). The examiner avatar never reacts to
correctness.

**Why follow-ups must not teach:** if a follow-up gave away the answer, a complete answer
afterwards would prove nothing. Because probes do not teach, knowledge that appears after them
was already there. That is the core logic behind "likely communication difficulty".

## 9. The deciders: knowledge gap versus communication difficulty

### Per spoken answer: three signals, all from the pilot

| Signal | Fires when | Source of the number |
|---|---|---|
| Speed and pauses | 2 of 4 beyond: speech rate < 2.53, articulation < 3.59, run < 5.73, mean pause > 682.5 ms; at least 10 s of speech | Pilot (Youden J) |
| Fillers | 5.42 or more per 100 words, and at least 2 | Pilot |
| Repeats and restarts | 0.34 or more per minute of speech, and at least 2 | Pilot (exploratory, p = 0.139) |

- **Difficulty heard** = 2 or more signals, at least one heard in the words (fillers, or repeats
  and restarts).
- **Hedges** ("maybe", "I think") are still counted and stored, but left the decision in 1.10:
  not measured in the pilot, and as likely to show doubt about the answer as a language difficulty.
- **"At least 2" guard:** pilot rates are whole-viva rates; one answer is short, so a single
  "um" or "sorry" never counts alone.

### Per topic, in order (the first match decides)

| # | Situation | Result |
|---|---|---|
| 1 | Skipped or not reached | Not enough evidence |
| 2 | First answer covers **80%+**, still 80%+ at the end without a simpler question, and difficulty heard in the first answer | **Likely communication difficulty** |
| 3 | First answer 80%+, no difficulty | No gap identified |
| 4 | Only one answer | Not enough evidence |
| 5 | The same misconception twice in a row | **Likely knowledge gap** |
| 6 | Last two real answers at most **50%**, or every answer at most 50% with a real attempt | **Likely knowledge gap** |
| 7 | 80%+ at the end, but only after a simpler question | Reached with help |
| 8 | Two non-teaching follow-ups both reach **66%+**, the last 80%+, **and difficulty heard in at least one answer** (without it: reached with help) | **Likely communication difficulty** |
| 9 | 80%+ after one follow-up, difficulty heard in the first answer | **Likely communication difficulty** |
| 10 | Otherwise | Not enough evidence |

Then: difficulty heard and the best answer at **51 to 79%** gives **"Speaking difficulty
seen; knowledge unclear"**.

Whole viva headline: all topics the same gives that result; one kind of gap with the other topics
fine (or speaking-unclear next to communication) names that gap; really different results give
"Mixed results". The stored research category never changes.

### Why these percentages

| Number | Why | Data-derived? |
|---|---|---|
| **80%** | "Knowledge shown" means most points; one half-credited point should not hide knowledge (a 90% answer was stuck as partial in my P00 test viva, 1.7) | Design choice |
| **50%** | At most half after non-teaching follow-ups is a weak grasp; half credits can land exactly on 50 (1.7) | Design choice |
| **66%** | Two-thirds on two follow-ups in a row is a consistent recovery | Design choice |
| **51 to 79%** | Between the two: difficulty is real, knowledge partly shown, so the cause is unclear | Design choice |
| Speed, filler and repair cut-offs | Best separation of the 10 pilot students | **Yes** |

Say it plainly at PP1: the speech thresholds come from my data; the content percentages are
transparent design choices that PP2 calibrates against expert ratings.

### "Is it nerves, English level or health?"

The system describes what happened in this viva: the knowledge came through, but speaking was
slower and more hesitant than the pilot's comfortable speakers. It does **not** say why.
English proficiency and speaking anxiety overlap in L2 speaking (foreign language anxiety);
fatigue, illness or a speech condition would look similar and are out of scope. That is why the
result says "likely", a lecturer reviews it, and the student gets practice advice, never a label.

---

## 10. What the student and lecturer see

- **Student report:** the headline result, coverage ring, what went well, each topic with covered
  and missing points and "Why this result", a study plan (what to revise), a speaking plan (how to
  practise, with the measured reason), the questions and answers, "What next?" buttons.
- **Lecturer:** the same report plus the signals with values and thresholds, the overview
  dashboard, the question bank (course, material, AI or hand-written questions, review and
  approval) and the Speech lab (upload a recording, see pilot and literature verdicts side by side).

## 11. Privacy and ethics

- Codes only; no names or emails. Consent before recording.
- Study recordings stay on my laptop and backup drive; consent allows Groq and Google Colab
  transcription; all data deleted by June 2027; reports show combined results only.
- Live viva: audio processed in memory and discarded; transcripts and numbers saved for the report
  and lecturer review; a viva can be deleted completely.
- At PP1 do not play student recordings (a voice identifies a person); combined results, my own
  voice and the consent timestamps are fine.

## 12. Limitations

1. **Small pilot:** 5 + 5 students; only large differences can reach significance.
2. **Extreme groups:** chosen by self-report at the extremes, which makes separation easier than
   in a normal class.
3. **Self-report grouping:** no independent English test.
4. **Thresholds fitted on the same 10 students:** leave-one-out helps; PP2 must test new ones.
5. **Content percentages (80, 50, 66) are design choices,** not yet calibrated.
6. **Live transcriber undercounts fillers** (about 67% kept) and can mishear technical words;
   live syllable counts run 5 to 15% low because Groq drops repeats and cut-off words.
7. **Cause unknown:** nerves, proficiency, fatigue and health are not separated.
8. **Hedges** are stored but not used: not measured in the pilot, and ambiguous (doubt about the
   answer or language).
9. **One subject (IT1010) and one university.**
10. **System:** temporary code login; C1 and C2 mocked; Groq free tier means about one student at a
    time; depends on internet (Neon and Groq).
11. **The AI marker can be wrong;** speech-to-text errors are ignored by design, and the student
    can correct the transcript.

## 13. Questions the panel may ask (with answers)

1. **How do you know it is not just a knowledge gap?** The study controlled knowledge (MCQ median 9
   in both groups). Live, a communication result needs 80% of the points shown, and follow-ups
   never teach, so the knowledge was already there.
2. **Why not just count fillers?** Transcribers drop them (local Whisper kept 7%, Groq 67%) and
   fluent speakers use them too. Speed and pauses separated my groups better (AUC 1.00 for speech
   rate). Fillers are one of three signals.
3. **Why your own thresholds instead of the literature?** The literature values come from Chinese
   learners in monologues; on my students they caught only 3 of 5. The pilot cut-offs sorted all 10.
4. **Isn't 10 students too few?** For a pilot, yes, and I say so. The effects are large (AUC
   0.92 to 1.00) and leave-one-out estimates accuracy on unseen students. PP2 tests the cut-offs on
   new students.
5. **Aren't your thresholds overfitted?** They are fitted on these 10, so leave-one-out (0.70 to
   1.00) is the honest estimate, and PP2 is the real test.
6. **How accurate are your measurements?** The counting check: rho 0.98 for fillers, 0.99 for
   pauses, 0.75 for repairs, against my own listening.
7. **What exactly does "likely communication difficulty" mean?** The knowledge came through but
   speaking was slower and more hesitant than comfortable peers. It describes, it does not
   diagnose.
8. **What if a student is just nervous?** The system cannot separate nerves from proficiency, and
   in L2 speaking they overlap. It is a supportive flag for a lecturer, not a verdict.
9. **What if the student does not know the answer and rambles?** Coverage stays low, so the rules
   give "likely knowledge gap" (at most 50%) or "knowledge unclear" (51 to 79%), never communication
   difficulty.
10. **Is the AI deciding the result?** No. The AI marks content and words follow-ups; fixed,
    versioned rules decide, and every report shows why.
11. **What if the AI marks wrongly?** Marking ignores speech-to-text errors; the student can
    correct the transcript; the lecturer sees the evidence and the rubric points.
12. **How do follow-ups avoid teaching?** Probes are reviewed in the question bank, must not state
    the answer, are checked against the rubric keywords, and quote the student's own words.
13. **Why 2 of 4 measures?** One slow measure can come from a long think; two lower false alarms.
14. **Why 80% and 50%?** Design choices: most points shown versus at most half; PP2 calibrates them
    against expert ratings.
15. **Why separate audio tracks?** So my voice, my questions and the listening time are never
    counted as the student's pauses.
16. **Why CrisperWhisper for the study and Groq live?** CrisperWhisper is verbatim but needs a GPU
    and takes minutes; Groq is fast enough for a live viva.
17. **What is stored? Is it ethical?** Codes only; no audio stored; consent before recording; data
    deleted by June 2027; combined results only.
18. **How does it fit AdaptLearn?** C3 supplies the questions, C2 load shortens the viva, C1 mastery
    is reference evidence; sending review flags back to the platform is planned for PP2.
19. **What is new here?** Data-derived L2 fluency thresholds for technical vivas, combined with
    rubric coverage and non-teaching follow-ups to separate knowledge from communication.
20. **What happens in PP2?** Integration with C1 to C3 and the university login; testing the
    cut-offs on new students with expert ratings; a dedicated audio filler detector.
21. **Why did repairs not reach significance?** p = 0.139 with 5 + 5 students; the difficulty
    median was 1.24 per minute against 0, so the direction is right, the sample is small. It is
    used as an exploratory signal.
22. **What is AUC / Youden J / leave-one-out?** See section 6, "How it was analysed".
23. **What is the response latency result?** 3.84 s against 2.62 s, not significant (p = 0.095);
    it is not used to decide.
24. **What does the student get?** A report with what went well, a study plan and a speaking plan,
    each item with its reason.
25. **What if speech recognition fails or the internet drops?** The student can type; the page
    retries; Gemini backs up the AI; a laptop transcriber backs up Groq.

## 14. Glossary

| Term | Meaning |
|---|---|
| L2 | A second language (English, for most SLIIT students) |
| Fluency (utterance fluency) | Measurable smoothness of speech: speed, breakdown (pauses), repair |
| Syllable | A unit of sound; used to measure speaking speed |
| Mean length of run | Average syllables spoken between two silent pauses |
| Silent pause | Silence of 250 ms or more inside speech |
| Filled pause / filler | "um", "uh", "er" |
| Repair | A repeat, a cut-off word or a self-correction |
| Hedge | "maybe", "I think", "I'm not sure" |
| VAD | Voice activity detection: finds where speech starts and stops |
| Rubric point | One idea the answer must contain |
| Coverage | Share of rubric points shown (half credit for partial) |
| Scaffolded | The student got a simpler question, which counts as help |
| Youden J | The cut-off that maximises sensitivity + specificity - 1 |
| Sensitivity / specificity | Share of difficulty students caught / comfortable students not flagged |
| Holm correction | Adjusts p-values when testing several measures |

## 15. Key numbers to remember

- 10 students (5 + 5), MCQ median 9 and 9, p = 1.000.
- Speech rate 1.91 vs 3.64 syllables/s (AUC 1.00); run 4.45 vs 12.25 syllables (AUC 1.00).
- Pilot cut-offs: 2.53 / 3.59 / 5.73 / 682.5 ms; fillers 5.42 per 100 words; repairs 0.34 per minute.
- Literature rule 3 of 5 caught; pilot rule 10 of 10.
- Counting check rho: fillers 0.98, pauses 0.99, repairs 0.75.
- Live transcriber keeps 67% of fillers; local Whisper 7%.
- Live rules: 2 of 4 speed measures, 10 s minimum, 2 signals with one in the words, 80% knowledge
  shown, at most 50% knowledge gap, 51 to 79% unclear.
