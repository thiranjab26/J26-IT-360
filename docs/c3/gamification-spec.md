# C3 gamification layer: levels, bonuses, badges and quests

The values below are the ones the platform uses. They live in
`backend/services/tutor-service/app/gamification/progression.py` (and `xp.py` for the
per-checkpoint points). A unit test (`tests/unit/test_gamification_spec.py`) fails if this
document and the code disagree, so change both together.

Status: first version for the PP1 demo. The numbers are defaults chosen for a 13-concept
module and are expected to be tuned after the first student sessions.

## Design rules

1. **Rewards are identical in both study conditions.** Research claim 3 compares
   mastery-gated and points-only unlocking. Only what XP is allowed to unlock differs
   (`rules.py`). Every XP value, bonus and badge here is paid the same in both, so a
   difference in learning gain cannot come from one group being rewarded more.
2. **Rewards are for demonstrated work.** Finishing a session, passing on the first try,
   mastering a concept. Nothing pays for guessing a multiple-choice quick check or for time
   spent.
3. **Nothing is paid twice.** Each bonus carries a reference (the concept and day, the
   concept, the topic, or the day it was earned for) and the database refuses a second
   bonus with the same kind and reference. A badge is held once, ever.
4. **A bonus for replaying is limited.** The concept-cleared and flawless bonuses are paid
   once per concept per local day, so repeating a concept for the bonus is not a grind. The
   checkpoint points still count every time.

## Points per checkpoint (existing)

| Event | XP |
|---|---|
| Gating checkpoint passed first try, no hint | 120 |
| Quick check (multiple choice) answered correctly | 10 |
| Each hint used on a gating checkpoint | minus 30 |
| Each extra try after the first on a gating checkpoint | minus 20 |
| Minimum for passing a gating checkpoint | 20 |
| A checkpoint not passed | 0 |

A concept with two quick checks and two gating checkpoints, all clean, earns 260 XP.

## Bonus XP

| Bonus | XP | Paid when | Once per |
|---|---|---|---|
| Concept cleared | 50 | A session ends completed, or ends early because mastery was shown | concept per day |
| Flawless run | 50 | The same session, and every checkpoint answered was passed on the first try | concept per day |
| Concept mastered | 100 | The mastery estimate for a concept reaches 70% for the first time | concept, ever |
| Quest complete | 150 | Every concept in a topic is mastered | topic, ever |
| Streak bonus | 25 | A session finishes on a day when the learning streak is 3 days or more | day |

A first, clean session on one concept therefore earns 260 + 50 + 50 + 100 = 460 XP.

## Levels

Total XP, including bonuses, sets the level.

| Level | Name | Total XP needed |
|---|---|---|
| 1 | Rookie | 0 |
| 2 | Apprentice | 150 |
| 3 | Coder | 400 |
| 4 | Debugger | 800 |
| 5 | Tracer | 1300 |
| 6 | Architect | 1900 |
| 7 | Expert | 2600 |
| 8 | Master | 3500 |
| 9 | Grandmaster | 4600 |
| 10 | Legend | 6000 |

## Badges

| Badge | Rarity | How it is earned |
|---|---|---|
| First Steps | common | Finish your first session. |
| Sharp Start | common | Pass a checkpoint on the first try. |
| Flawless | rare | Finish a session passing every checkpoint on the first try. |
| Comeback Kid | rare | Pass a checkpoint after a re-teach. |
| Concept Master | common | Master your first concept. |
| Topic Champion | epic | Master every concept in a topic and complete its quest. |
| On Fire | rare | Learn on 3 days in a row. |
| Week Warrior | epic | Learn on 7 days in a row. |
| Half a Grand | common | Earn 500 XP. |
| Two Thousand Club | rare | Earn 2,000 XP. |

Rarity only changes how the unlock is celebrated on screen. It has no effect on XP.

## Streaks

A streak is the number of consecutive local days on which the student answered at least one
question (a correct or a wrong answer; an unreadable answer does not count). The local time
zone is `TUTOR_TIMEZONE` (default `Asia/Colombo`).

A streak is still alive on the day after the last learning day, so the screen can say
"learn today to keep it". Missing a whole day ends it.

## Quests

Every topic in a module is a quest: master every concept in it (70% mastery each). Completing
a quest pays the quest bonus once and earns Topic Champion if it is the first. The quest list
for Programming Fundamentals in Java is: Getting Started, Basics, Control Flow, Methods,
Arrays, Objects, Program Tracing.

## Not in this version

The boss checkpoint (a topic-ending challenge with double XP) is planned after PP1.
Badges for practicals and grading arrive with those modes.
