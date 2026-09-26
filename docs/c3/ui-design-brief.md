# Claude Design Prompt - VeriTutor UI Mockups

Copy everything below the line into Claude Design.

---

Design a high-fidelity UI mockup set for **VeriTutor**, a faithfulness-verified, gamified AI tutoring web app for university Computer Science students. This is for a final-year research project presentation, so it needs to look like a real product, not a wireframe. Desktop web, 1440px wide.

## What the product does

VeriTutor teaches Data Structures & Algorithms through **guided tutoring sessions**, not open chat. The tutor leads: it teaches a concept, makes the student produce an answer, checks it, and moves on. Three things make it different from a normal AI tutor, and **all three must be visible in the UI**:

1. **Every generated statement is verified** against the course material before the student sees it. Show this as a persistent, quiet trust signal - not a popup.
2. **Progress unlocks on proven mastery**, not points. Locked content shows *why* it's locked in mastery terms.
3. **Content adapts to the student's real-time cognitive load** (low / moderate / high), detected in-browser. Explanations get shorter and more scaffolded when load is high.

## Design direction

- Calm, focused, academic - closer to Linear or Notion than to Duolingo. Gamification should feel earned and substantive, not childish. No cartoon mascots, no confetti explosions.
- Restrained colour: one primary accent, one success green, one warning amber. Neutral greys carry most of the interface.
- Generous whitespace. The student is reading and thinking, not scanning a feed.
- Monospace font for all code and traces.
- Progress and XP should read as instrumentation, not slot-machine reward.

## Screens to produce

### Screen 1 - Quest Map (session entry point)
The module overview. Seven DSA topics shown as a connected path: Complexity Analysis → Arrays & Linked Lists → Stacks & Queues → Recursion → Trees & BSTs → Hashing → Sorting & Divide-and-Conquer.

Must show:
- Completed topics (with mastery percentage), the current topic, and locked topics
- Locked topics display the reason in mastery terms, e.g. "Requires 70% mastery in Recursion - currently 45%"
- Three **Boss Checkpoints** as distinct, larger nodes after Recursion, Trees, and Sorting
- A sidebar with: current XP, session streak, earned badges (e.g. "Recursion Rookie", "Trace Master"), and overall module mastery
- A resumable session card at the top: "Resume: Recursion - Unit 3 of 4 · paused 2 hours ago"
- Primary CTA: "Start Session"

### Screen 2 - Active Tutoring Session (teaching beat)
The tutor is mid-explanation. This is the core screen.

Must show:
- Session header: topic name, unit progress ("Unit 2 of 4"), checkpoint dots showing passed/current/upcoming
- The tutor's explanation of recursion base cases, with a short code block
- A small, quiet **verification chip** near the explanation: a shield or check icon with "Verified · 4 claims checked against Unit 2.1" - clickable, hinting it can be expanded
- A **cognitive load indicator** in the header showing "Load: Moderate" with a subtle three-bar meter
- A collapsed "Ask a question" input at the bottom, clearly secondary to the session flow - this is the help channel, not the main interface
- Primary CTA: "Continue"

### Screen 3 - Checkpoint (free-text / trace question)
The student must produce an answer, not select one.

Must show:
- Question: trace `factorial(4)` through the call stack, frame by frame
- A structured input area for the student's trace - monospace, multi-line
- Attempt indicator: "Attempt 1 of 3"
- A "Need a hint?" affordance that notes hints reduce XP earned
- XP available for this checkpoint shown discreetly
- Submit button

### Screen 4 - Verified Feedback (the key screen)
The student got it partially wrong. The tutor explains why.

Must show:
- The student's submitted trace with the incorrect step highlighted
- The tutor's explanation of the error, grounded in course material
- **An expanded verification panel** - this is the most important element in the whole mockup. Show the explanation broken into 3–4 individual claims, each with a green check and the source unit it was verified against (e.g. "Each recursive call creates a new stack frame ✓ Unit 2.1"). One claim should show as **blocked and regenerated** with an amber indicator and the note "Unsupported claim removed and regenerated."
- XP awarded partially, checkpoint marked for retry
- CTA: "Try again"

### Screen 5 - Practical / Coding Quest
The topic practical, unlocked after checkpoints pass.

Must show:
- Quest title: "Broken Chain" with a short scenario framing
- A split view: buggy linked-list insertion code on the left (editable, monospace, with a line visibly flagged), and on the right a free-text field: "Explain what the original code did wrong"
- Test results panel showing 2 of 4 hidden tests passing
- A quest progress bar and the XP on offer
- Note that both the fix and the explanation must pass

### Screen 6 - Inline MCQ pulse check
A small, fast recall check that appears mid-session - show it as a compact card, visually lighter than a checkpoint.

Must show:
- A four-option question on stack vs queue semantics
- A clear label indicating this is a quick check that **does not affect unlocks**
- The same verification chip, smaller

### Screen 7 - Learner Dashboard
Progress overview.

Must show:
- Mastery map across the seven topics as a bar or radial chart
- Badge collection, some earned and some locked with their mastery requirements
- Session history with **typed exit states**: Completed, Mastery-satisfied, Struggling, Paused (resumable), Load exit
- XP total and current streak
- A small stat: "Claims verified this week: 1,247 · Blocked: 18" - this makes the research contribution visible on the dashboard

## Things to get right

- The verification indicator must appear on **every** screen where generated content is shown - explanations, feedback, practicals, and MCQs. That consistency is the whole point of the product.
- Locked content must always state its mastery requirement. Never just show a padlock.
- The cognitive load indicator should be visible but unobtrusive, and never show raw camera or biometric data - only the categorical level.
- The chat input must look clearly subordinate to the session flow on every screen it appears.

Produce all seven screens as clean, presentable mockups with realistic content - no lorem ipsum, no placeholder boxes.
