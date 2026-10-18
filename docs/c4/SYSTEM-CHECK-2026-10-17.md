# System check before PP1 (17 Oct 2026)

How it was checked: a separate copy of the backend (port 8402, a throwaway database with the 24
C3 questions, the real Groq AI and voice), 5 scripted vivas with good, partial, wrong, "I don't
know" and "I don't understand" answers, the voice and speech-to-text path, the 115 backend
tests and the frontend production build. Your real database was not touched.

## What works

| Part | Result |
|---|---|
| Login, topics, start a viva | Works |
| Marking | Good answers complete, partial answers partial, a wrong claim caught as a misconception, "I don't know" as not an answer |
| Follow-ups | Quote the student's own words; "I don't know" gets "That's okay" and a plainer question, then an easier one |
| Report | Result, coverage, study plan with reasons; "Strong answers" when every first answer is complete |
| Examiner voice | About 3 s the first time (the next question is voiced in advance), instant when repeated |
| Speech to text | About 0.8 s for 15 s of speech; returns the 4 fluency measures judged by the pilot thresholds |
| Speed per typed answer | 1 to 2.6 s on the server; one answer took 11 s when the Groq free tier hit its limit and the backup AI answered |
| Tests and build | 115 tests pass; frontend typecheck and production build pass |

## Problems found (fixed 18 Oct: 1 to 4 and 6 in code; 5 by `frontend/.env.local`)

| # | Problem | Seen | Fix | Size |
|---|---|---|---|---|
| 1 | "I don't understand the question" brings back a generic question ("In your own words, what do you understand about Loops?") instead of the same question in plainer words | 2 of 2 tries | The AI's plainer wording of a two-part question has two question marks and is rejected; allow that for this case, and fall back to the original question, not the generic one | Small |
| 2 | The report contradicts itself when a student reaches every point only after help: "There were not enough clear answers to give a result. Try the viva again" next to "You covered every expected point" | 1 of 5 vivas | A student-facing result "Reached with help" (the research category is unchanged) | Small to medium |
| 3 | Follow-ups repeat themselves: two in a row start with the same quote, and two in a row ask almost the same thing | 2 of 5 vivas | Reject a follow-up that shares most of its words with an earlier one, so the AI writes a different one or the reviewed probe is used | Small |
| 4 | One follow-up did not make sense: "You said multiplication happens before addition. How does that rule affect the result of x > 0?" | 1 | Comes from the rule that every follow-up quotes the student. Option: when the missing point has nothing to do with what the student said, ask the reviewed probe without a quote. Your decision | Small |
| 5 | Each new connection to `localhost` costs about 0.2 s on this laptop; `127.0.0.1` is instant | Every page | Point the frontend at `127.0.0.1:8401` | One line |
| 6 | The lecturer explanation says "One non-teaching follow-up revealed the knowledge" when it took two | 1 | Reword to "A follow-up revealed ..." | One line |

## Limits to state at PP1 (PP2 work)

- **Fillers in the live viva:** Groq keeps about 7% of fillers, so the filler signal rarely fires.
  A communication result needs the fluency signal plus a signal heard in the words (your rule:
  timing alone never decides), so today that word signal mostly comes from hedges and restarts.
  PP2: the filler detector.
- **Login:** a temporary participant-code login; the university login comes with the team
  integration in PP2.
- **AI capacity:** the Groq free tier handles about 4 answers a minute, so one student at a time.
- **Thresholds:** set from 10 pilot students; live speech rates read slightly slow because Groq
  drops repeats and cut-off words.
- **C1 and C2 context:** mock values, labelled as such, until the team integration.
