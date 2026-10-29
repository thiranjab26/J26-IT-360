# How the C4 viva decides (19 Oct 2026)

Plain answers to five questions: the gap rules, what is saved and why, how the next question is
chosen, misheard words, and what the research is checking. Rule versions: gap rules
`c04-gap-1.10-pilot-signals-only`, follow-up policy `c04-policy-1.6-misheard-viva`.

## 1. Gap rules 1.8

### Per spoken answer: three signals (hedges left the decision in 1.10)

| Signal | Fires when | From |
|---|---|---|
| Speed and pauses | 2 of 4 measures past the pilot cut-offs (speech rate < 2.53, articulation < 3.59, run < 5.73 syllables, mean pause > 682.5 ms), at least 10 s of speech | Pilot data |
| Fillers (um, uh) | 5.42 or more per 100 words, and at least 2 | Pilot data |
| Repeats and restarts | 0.34 or more per minute of speech, and at least 2 | Pilot data (exploratory) |

**Difficulty heard** = 2 or more signals, at least one heard in the words (fillers, or repeats
and restarts). Timing alone never counts.

**Knowledge shown** = 80% or more of the marking points (complete, or partial with one point half
credited).

### Per topic, checked in this order

| # | Situation | Result |
|---|---|---|
| 1 | Skipped or not reached | Not enough evidence |
| 2 | First answer shows the knowledge, still shown at the end without a simpler question, and difficulty heard in the first answer | **Likely communication difficulty** |
| 3 | First answer shows the knowledge, no difficulty heard | No gap identified |
| 4 | Only one answer | Not enough evidence |
| 5 | The same misconception in two answers in a row | **Likely knowledge gap** |
| 6 | The last two real answers at most 50%, or every answer at most 50% with at least one real attempt | **Likely knowledge gap** |
| 7 | Knowledge shown at the end, but only after a simpler question | Reached with help |
| 8 | Weak first answer, then two follow-ups that taught nothing both reach 66% or more and the last 80%, **and difficulty heard in at least one answer** (1.9; without it: reached with help) | **Likely communication difficulty** |
| 9 | Weak first answer, knowledge shown after one follow-up, difficulty heard in the first answer | **Likely communication difficulty** |
| 10 | Anything else | Not enough evidence |

Then, for a topic that ended "not enough evidence": if difficulty was heard and the best answer
covered 51 to 79%, it reads **Speaking difficulty seen; knowledge unclear**.

Whole viva: every topic the same result gives that result; otherwise "Mixed results", and each
topic shows its own.

## 2. What is saved, and why

| Saved | Why |
|---|---|
| The transcript the student submitted | Marking, the report's "Questions and your answers", lecturer review |
| The spoken transcript (with fillers) | Fillers and repeats are counted from it; if a rule changes, the counts can be recomputed |
| The numbers: pauses, speed, filler and repeat counts, marks, covered points | The report and "Why this result" are built from them; PP2 tests the pilot cut-offs on new students with them |
| Rule versions | Every result can be traced to the rules that made it |

Not saved: the audio (processed in memory, then discarded) and names (only participant codes).
The student agrees to this at sign-in ("my answers and their timing are saved so my lecturer can
review them"). The delete button removes a viva and everything in it.

## 3. How the next question is chosen (fixed rules; the AI only words it)

| The answer was | Next |
|---|---|
| Complete | Next topic |
| Partial | Ask about one missing marking point (its reviewed probe, adapted to the student's words) |
| Too brief | Ask why it works, or for an example in words |
| Based on a misunderstanding | A small concrete case: what does your idea predict here? It never says "wrong" |
| Incorrect | A simpler or prerequisite question (counts as help) |
| "I don't know" | First time: reassure and ask again in other words. Second time: a simpler question |
| "I don't understand the question" | The same question in plainer words; not marked, no follow-up used up |
| "Skip this question" / "Stop the viva" | Next topic / finish |

Limits: at most 2 follow-ups per topic (1 when C2 reports high load), then the next topic. A
follow-up that would repeat an earlier one is replaced, or the viva moves on.

## 4. Misheard words ("bloat" for "float")

Today: the student can correct the transcript before sending it, and marking ignores
speech-to-text errors (9 Oct). But the follow-up writer may still quote the error ("You said bloat
is ...").

Two fixes (added 19 Oct 2026):

1. **Prime the transcriber with the question's terms.** Groq Whisper accepts a prompt; today it is
   generic ("This viva is about programming"). Adding the topic's key words (float, integer,
   boolean, string) makes it far more likely to hear "float".
2. **Tell the follow-up writer** to quote the intended course term when a word is clearly misheard
   (bloat to float), or not to quote that phrase.

## 5. What the research checks

**Research question.** When knowledge is controlled, which speech measures separate Sri Lankan
students who have communication difficulty in English technical vivas from those who do not, and
at what thresholds? (Supervisor's framing: is there a gap in technical communication for students
with English as a second language? The pilot answers yes, and the thresholds detect it.)

**The problem.** A normal viva sees a weak spoken answer and concludes "does not know". For a
student answering in a second language, a weak answer can hide real knowledge. The two need
different help: revision for a knowledge gap, speaking practice and a fairer judgement for a
communication difficulty.

**What "likely communication difficulty" means.** The knowledge was there (enough marking points
came through), but getting it out in spoken English was hard: slower speech, longer pauses, more
fillers and repeats than the pilot's comfortable speakers. It describes what happened in this
viva. It is not a diagnosis of why.

**Nervousness, English level, health?** The system cannot tell these causes apart and does not
claim to. English proficiency and speaking anxiety overlap in second-language speaking (foreign
language anxiety); your pilot grouped students by their own report that English makes vivas hard.
Fatigue, illness or a speech condition would look similar and are out of scope. That is why the
result says "likely", why a lecturer reviews it, and why the student's message is supportive
practice advice, never a label.

**How it is checked.**

| Step | Pilot study (PP1) | Live viva |
|---|---|---|
| Knowledge controlled | MCQ, 7 of 10 or more, groups equal (median 9 and 9) | Marking points covered after follow-ups that do not teach |
| Speech measured | CrisperWhisper words, Audacity counting check | Groq transcript, Silero VAD pauses |
| Decision | Group differences, best cut-offs, leave-one-out accuracy | The pilot cut-offs inside the gap rules |
| Next | | PP2: test the cut-offs on new students; filler detector |
