# Fairer marking, 9 Oct 2026

What changed in how the C4 viva marks spoken answers, why, what it does to results, and how to
undo it. Prompted by the owner's own test viva on Programming basics, which came out at 17%
coverage and "Likely knowledge gap" although the answers showed real, partial understanding.

## 1. The problem

The owner answered 6 questions (2 concepts, each with 2 follow-ups). The system's marks:

| Answer | What the student actually showed | System said |
|---|---|---|
| Variables, main | Wrong: "a variable is a data type". Mostly right types: float is "decibel" numbers (speech-to-text for "decimal"), boolean is 0 and 1, string is letters. Wrong: integer is "all numbers" | 0% |
| Variables, follow-up 1 | Right: "something you assign a value with a name; shape is the variable, square is the value, so it is a string" | 33%, and a misconception the student did not repeat |
| Variables, follow-up 2 | Right: count = 5 is an integer | 33% |
| Operators, main | Did not know 2 + 3 * 4. Described x > 0 and x < 10 separately, not that both must hold | 0% |
| Operators, follow-ups | "Operators are to calculate" (half right); a comparison "produces x greater than zero values" (wrong: true or false) | 0%, 0% |

Result: 17% coverage, Likely knowledge gap for both concepts and the session. A fair reading is
about 60 to 70% for variables (an early confusion, corrected after one follow-up: Mixed) and about
25% for operators (a real gap: precedence and boolean results), so about 45% and Mixed overall.

Four causes, all fixed below:

1. **All-or-nothing points.** The marker could only say covered or not covered. The rubric
   bundled several facts into one point ("types" needed all four types right; "examples" needed
   an example for each), so 3 of 4 types right scored 0 for that point.
2. **No allowance for speech.** The marker was not told it reads automatic speech recognition of
   a second-language English speaker, so the misheard "decibel" counted against the student.
3. **False misconception flags.** The marker flagged "a variable is a data type" in an answer that
   no longer said it. A flagged misconception also stops earlier credit from carrying forward, and
   it made the next follow-up quote the old mistake ("You said...").
4. **Too much in one question.** The variables question asked for a definition, four types and four
   examples in one spoken answer.

## 2. What changed at a glance

| Change | Before | After |
|---|---|---|
| Marking scale per rubric point | covered or not | `full`, `partial` or `none` |
| What full marks need | the idea, in any correct paraphrase | the idea **and** its key technical term (the owner's rule) |
| Everyday wording, analogies, part of a point | 0 | half credit (`partial`) |
| Speech-to-text errors | counted against the student | ignored when the meaning is clear; "decibel" for "decimal" counts as the term |
| Misconceptions | any the model listed | only with a quote of the student's own words from the current answer |
| Credit from earlier answers | covered points only | the best level each point reached |
| Model says "complete" with gaps | the answer failed with an error | becomes `partial` |
| Report "Worth revisiting" | the missing point | partial points say "(idea shown; name it precisely)" |
| Questions | 3 had bundled points | rewritten: one fact per point |
| Loader | replace everything | also `--update`: refresh questions in place, keep sessions |

## 3. Added

### 3.1 Three-level marking with partial credit

The model grades every rubric point:

- **full**: the idea is correct and stated with the point's key technical term, or an exact synonym.
- **partial**: the idea is right or close but only in everyday words or an analogy ("a labelled box
  that keeps data"), or only part of the point is correct.
- **none**: missing or wrong.

The server then computes coverage as `100 x (full + 0.5 x partial) / points`. Example: a variable
point at full, a type point at partial and an example point at none give (1 + 0.5 + 0) / 3 = 50%.
`covered` is true only for full, so follow-ups still target anything below full: a student who had
the idea in everyday words is asked for the precise term.

### 3.2 Speech-tolerant instruction

The marker is now told that the transcript is automatic speech recognition of a second-language
English speaker answering aloud. It judges what the student meant and ignores grammar, fillers and
words the recognizer clearly misheard. A misheard technical term ("decibel" for "decimal") counts
as the term, because the student said it correctly; it is the recognizer's error, not the
student's. Everyday wording alone never gets full marks.

### 3.3 Misconceptions must quote the student

The model must copy the student's exact words that state a misconception. The server checks that
the quote (at least two words) appears in the current answer and drops any it cannot find; the
reason then says "A suggested misconception was not counted: it was not in the answer's own words."
If every misconception is dropped, a "misconception" state becomes partial (or incorrect at 0%).
In plain words: the system may only say "you made a mistake" if it can point to where you said it.

### 3.4 "Idea shown" note in the report

Points marked partial appear under "Worth revisiting" with "(idea shown; name it precisely)", so a
student sees that they had the idea and only need the term.

### 3.5 In-place bank refresh

`app/domain/c3_bank.py` gained `update_bank(db)` and the loader gained `--update`:

```bash
cd backend/services/viva-service
uv run python scripts/load_c3_bank.py --update   # back up, then refresh the C3 questions in place
```

It backs up every viva table to `../C4-db-backups/`, then refreshes courses, materials and questions.
Sessions, people and ratings stay; sessions keep the question snapshot they started with. A changed
question gets the next version number. Used today: 3 questions refreshed (backup
`viva-backup-2026-10-09-1037.json`).

### 3.6 Tests (4 new)

| Test | Checks |
|---|---|
| `tests/unit/test_marking.py::test_everyday_wording_earns_half_and_full_needs_the_term` | partial counts half; complete with a partial point becomes partial; the instruction carries the speech rules; the model must return a level per point |
| `...::test_a_misconception_counts_only_with_the_students_own_words` | a misconception the student did not say is dropped and explained; one they did say is kept |
| `...::test_points_keep_the_best_level_from_earlier_answers` | full and partial credit carry forward; older results without a level still work |
| `tests/integration/test_c3_bank.py::test_update_bank_refreshes_questions_and_keeps_sessions` | `--update` changes only edited questions, bumps the version and keeps sessions |

## 4. Changed

### 4.1 The marking instruction (`ASSESS_RULES` in `app/integrations/llm.py`)

Kept: assess only the rubric; credit points shown even when a follow-up asked about something else;
combine earlier evidence; `non_answer` only with no content; never choose an action; never infer
confidence from fluency. Replaced: "accept correct paraphrases" became the three-level rule; "judge
misconceptions from the current answer" became the quote rule. Added: the speech rules and
"complete needs every point at full". The follow-up instruction now targets the first point
"below full" instead of "not covered".

### 4.2 Three questions rewritten (`app/domain/c3_bank.py`)

**Variables and data types** (IT1010 Programming basics). The question now asks for one example
value instead of one per type.

| Before (3 points) | After (5 points) |
|---|---|
| variable: name for a stored value | variable: named storage location for a value; assigning replaces it |
| types: integer, float, boolean, string all described | integer_float: whole numbers versus decimal (fractional) numbers |
| examples: an example for the types | boolean: True or False |
| | string: text in quotes |
| | example: one correct value with its type |

A second known misconception was added: "a variable is the same thing as a data type".

**Operators and expressions** (IT1010 Programming basics).

| Before (3 points) | After (4 points) |
|---|---|
| kinds: arithmetic gives numbers, comparisons give booleans, logical operators combine booleans | precedence: multiplication before addition |
| precedence: 2 + 3 * 4 is 14 | result: 2 + 3 * 4 is 14 |
| range_check: x > 0 and x < 10 means between 0 and 10 | boolean_result: a comparison gives True or False |
| | and_both: "and" is true only when both are true, so x is between 0 and 10 |

**Tree structure and traversal** (IT2070 Trees). The question no longer asks for height.

| Before (3 points) | After (4 points) |
|---|---|
| terms: root, leaf and height | root_leaf: root is the top node, a leaf has no children |
| orders: the three traversal rules | preorder: node, left, right, giving 2, 1, 3 |
| example: the three traversals of the sample tree | inorder: left, node, right, giving 1, 2, 3 |
| | postorder: left, right, node, giving 1, 3, 2 |

Every new point quotes the course material exactly, so it passes the bank's grounding check when
staff edit and re-approve it. The other 21 questions already had one fact per point; partial credit
now handles partly right answers there too.

### 4.3 Other code

- `app/models/schemas.py`: each rubric hit can carry `level` (`full`, `partial`, `none`); older
  stored results have none and still read correctly.
- `scripts/load_c3_bank.py`: `--update` mode; `--apply` and `--update` cannot be combined.
- `docs/c4/spec-domain.md` section 3: the new rules.

### 4.4 Live database

The 3 rewritten questions were refreshed in place (now version 2). Nothing else changed: your
sessions, people and the other 21 questions are as they were.

## 5. Removed

- The covered-or-not scale in AI marking (demo-mode keyword marking still uses it).
- The "accept correct paraphrases" instruction (the three levels replace it).
- The error raised when the model said "complete" but left gaps; it now becomes partial, so a
  student's answer no longer fails with a provider error in that case.
- The bundled points `types`, `examples`, `kinds`, `range_check` (reworded as `and_both`),
  `terms`, `orders` and the tree `example`, replaced by the single-fact points above.

No table, endpoint, session, student or rating was removed.

## 6. Results on the owner's 6 answers

Re-marked with the live model (Groq `gpt-oss-120b`) after the change:

| | Variables | Operators | Session |
|---|---|---|---|
| Before | 33%, Likely knowledge gap | 0%, Likely knowledge gap | 17%, **Likely knowledge gap** |
| New marking, old questions | 50%, Mixed | 33%, Likely knowledge gap | 42%, Mixed |
| New marking, new questions | **70%, Mixed** | **25%, Likely knowledge gap** | **48%, Mixed** |

Answer by answer with the new questions:

| Answer | Points (full / partial / none) | Coverage | Notes |
|---|---|---|---|
| Variables, main | boolean and string partial; others none | 20% | two misconceptions, both quoted from the answer ("a variable is a data type", "integer is for all numbers") |
| Variables, follow-up 1 | string and example full; variable partial | 50% | no false misconception any more |
| Variables, follow-up 2 | string and example full; variable, integer_float and boolean partial | 70% | the int example earned credit |
| Operators, main | boolean_result partial | 12.5% | described each comparison without the word "boolean" |
| Operators, follow-up 1 | boolean_result partial | 12.5% | "operators calculate" earns nothing for the four points |
| Operators, follow-up 2 | boolean_result and and_both partial | 25% | real misconception kept, quoted: comparisons give "x greater than zero values" |

This matches the fair reading in section 1: the variables concept was understood with an early
confusion (Mixed), and operators has a genuine gap in precedence and boolean results.

## 7. Why it is better

1. **Fairer to second-language speakers.** Speech-to-text errors and everyday wording no longer
   erase what a student knows. This is the research's own concern: knowledge should not be judged
   by English fluency.
2. **Standards kept.** Full marks still need the technical terms, as the owner asked. A student who
   explains the idea in everyday words gets half credit and a follow-up that asks for the term.
3. **Closer to the research question.** "Knows the idea but cannot name it in technical English"
   is now visible (partial points and the "idea shown" note), which is part of what communication
   difficulty means in this study.
4. **Fewer false knowledge gaps.** Partial credit and correct carry-over mean a student with partial
   understanding no longer falls below the 50% "knowledge gap" line as easily.
5. **No accusations without evidence.** A misconception needs the student's own words, which also
   stops follow-ups from quoting a mistake the student has already corrected.
6. **More robust sessions.** A "complete" with gaps no longer fails the answer with an error.
7. **Same speed and cost.** Still one AI call per answer; the instruction is about 150 tokens longer.
   "Performance" here means marking quality, not speed.

## 8. What to keep in mind

- **Coverage numbers are higher than before** for the same answers. Do not compare old and new
  sessions' coverage directly. The gap-rule thresholds (50%, 66%, 80%) are unchanged, so after this
  change "Likely knowledge gap" is rarer and recovery after follow-ups is likelier.
- **The research dashboard** recomputes A, B and C outcomes from each session's stored marks, so old
  sessions keep their old marks.
- **The marker is still an AI.** Full versus partial is a judgement and can vary between runs. The
  quote rule favours the student: if the model paraphrases instead of quoting, a real misconception
  is dropped.
- **Groq's free tier** limits tokens per minute. Re-marking 12 answers in a row hit it once (the
  script waited and retried); a live viva uses one call per answer and stays well inside it.

## 9. How follow-ups and "You said..." work

Not random. For every follow-up:

1. Fixed policy rules choose the purpose from the marked state: correct a misconception, probe the
   first point below full, or step back to a simpler question when the answer was wrong.
2. The AI words the question in the same call as the marking. It must quote the student's own words
   and adapt the reviewed probe written for that rubric point.
3. The server checks the wording: the quote must be the student's words, the question must not give
   the answer away, and it must be answerable aloud; otherwise it uses the reviewed probe as written.

The quote rule from 3.3 removes the case where a follow-up repeated a mistake the student no longer
made.

## 10. Files

| File | Change |
|---|---|
| `backend/services/viva-service/app/integrations/llm.py` | `ASSESS_RULES`, `credit()`, `quoted()`; three-level schema; quote check; best-level carry-over; partial note; complete fix |
| `backend/services/viva-service/app/models/schemas.py` | `Hit.level` |
| `backend/services/viva-service/app/domain/c3_bank.py` | 3 questions rewritten; `update_bank()` |
| `backend/services/viva-service/scripts/load_c3_bank.py` | `--update` |
| `backend/services/viva-service/tests/unit/test_marking.py` | new, 3 tests |
| `backend/services/viva-service/tests/integration/test_c3_bank.py` | 1 new test |
| `docs/c4/spec-domain.md` | section 3 |
| `docs/c4/MARKING-UPGRADE-2026-10-09.md` | this document |

## 11. How it was checked

- Backend: 100 tests pass (4 new), ruff clean. No frontend change in this step.
- Live: the 3 refreshed questions are in the database; the backend restarted and lists 10 topics and
  24 questions; the owner's 6 answers were re-marked with the real model (section 6).

## 12. How to undo

Copies of every file before and after this change are in
`Intelligent Viva System/C4-backups/marking-2026-10-09/` (outside the repository).

1. Put the old 3 questions back in the database (dry run first, then `--apply`), from
   `backend/services/viva-service`:
   `uv run python "../../../../C4-backups/marking-2026-10-09/restore_old_questions.py" --apply`.
   It reads the backup taken just before the refresh (`C4-db-backups/viva-backup-2026-10-09-1037.json`).
2. Copy each file under `before/` back over the same path in the repository.
3. Delete `backend/services/viva-service/tests/unit/test_marking.py`.
4. Restart the backend and run the tests.

Or ask Claude to undo this change.
