# Module 1 - Data Structures & Algorithms
### Content, Assessment and Evaluation Plan
**Component 3 - Faithfulness-Verified Gamified AI Tutoring (VeriTutor)**
**AdaptLearn | J26-IT-360 | IT23252622 - Bandara H.M.T.L**

> Scope note: this is the authored content plan for the first of 2–3 prerequisite-linked modules. Topic boundaries and practical scenarios are expected to be refined during implementation; the structure, question taxonomy, and evaluation model are fixed.

---

## 1. Module structure at a glance

| # | Topic | Units | Prerequisite | Feeds into |
|---|---|---|---|---|
| T1 | Complexity Analysis | 3 | - | All topics |
| T2 | Arrays & Linked Lists | 3 | T1 | T3, T5 |
| T3 | Stacks & Queues | 3 | T2 | T4, T5 |
| T4 | Recursion | 4 | T3 | T5, T7, **Module 2 (DP)** |
| T5 | Trees & Binary Search Trees | 4 | T4 | T6, T7 |
| T6 | Hashing | 3 | T2 | - |
| T7 | Sorting & Divide-and-Conquer | 4 | T4, T5 | **Module 2 (DP)** |

**Total:** 7 topics, 24 theory units, 7 topic practicals, 3 boss checkpoints (after T4, T5, T7).

T4 and T7 are the exit points into Dynamic Programming - recursion plus overlapping subproblems is exactly the prerequisite pair used as the running example in the project problem statement.

---

## 2. Question type taxonomy

Five question types, used across all topics. Each has a different assessment purpose and a different grading path.

| Type | Purpose | Graded by | Gates progression? |
|---|---|---|---|
| **MCQ** | Fast recall check mid-session | Deterministic key | No - pulse check only |
| **Trace** | Step-by-step execution understanding | Auto-grader vs retrieved reference | Yes |
| **Predict-the-output** | Mental model of behaviour | Deterministic + generated explanation | Yes |
| **Explain / justify** (free text) | Conceptual understanding, reasoning | LLM auto-grader, NLI-verified rationale | Yes |
| **Code** (write / fix / complete) | Applied skill | Test execution + LLM rationale, NLI-verified | Yes |

**Design rationale for the panel:** MCQs are cheap enough to run inside a session without breaking flow, but can be answered by elimination, so they never gate an unlock. Free-text and code answers are what make the auto-grader a *generation* task - and therefore a faithfulness problem - rather than a lookup.

---

## 3. Practical types

| Type | Description | Where used |
|---|---|---|
| **Scenario practical** | A realistic situation the student must reason about and resolve | Every topic |
| **Debugging puzzle** | Deliberately broken code; fix and explain the fault | T2, T3, T5 |
| **Code completion** | Partial implementation with a missing core operation | T3, T6, T7 |
| **Comparative analysis** | Two approaches, choose and justify against complexity | T1, T5, T7 |
| **Hand-trace submission** | Student submits a written execution trace | T4, T7 |
| **Boss checkpoint** | Multi-concept synthesis; no hints, single attempt | T4, T5, T7 |

All practical content - scenario text, numbers, buggy code variants, distractors - is **generated per student from the retrieved theory unit**, not drawn from a fixed question bank. This is why generation-time faithfulness verification is required: a fixed bank would not need a gate.

---

## 4. Topic-by-topic plan

### T1 - Complexity Analysis

**Content covered**
- Counting operations; input size and growth rate
- Big-O notation; why constants and lower-order terms are dropped
- Best, worst, and average case
- Comparing growth rates at scale

**Questions**
- MCQ: identify the complexity of a given loop nest
- Trace: count operations for a nested loop with stated n
- Explain: why O(n) beats O(n²) at n = 10⁶ but not at n = 5
- Predict: which of two functions completes first for large n

**Practical - "The Profiler"** (comparative analysis)
Four code snippets; rank by asymptotic runtime and justify each ranking in free text.

**Evaluation**
Ranking correctness (deterministic) + justification quality (LLM-graded, NLI-verified rationale). Mastery evidence sent to C1 per attempt.

---

### T2 - Arrays & Linked Lists

**Content covered**
- Contiguous vs linked memory layout
- Access, insertion, deletion cost for each
- Pointer mechanics; head, tail, null termination
- Choosing between them for a stated workload

**Questions**
- MCQ: cost of insertion at head for each structure
- Trace: follow pointer reassignment through a mid-list insertion
- Predict: what breaks if two pointer assignments are swapped
- Explain: why array insertion at index 0 is expensive

**Practical - "Broken Chain"** (debugging puzzle)
A linked-list insertion with a deliberate pointer-ordering bug. Fix the code and explain in free text what the original version did wrong.

**Evaluation**
Test execution against hidden cases + explanation graded against retrieved reference. Both the fix and the explanation must pass.

---

### T3 - Stacks & Queues

**Content covered**
- LIFO and FIFO semantics
- Push/pop/enqueue/dequeue and their costs
- The call stack as a real stack
- Applications: undo, expression parsing, BFS frontier

**Questions**
- MCQ: which structure suits a stated application
- Trace: stack contents through a bracket-matching input
- Predict: queue state after a given operation sequence
- Explain: why a stack, not a queue, for undo

**Practical - "Balanced"** (code completion, extended mid-quest)
Implement bracket validation. The tutor then introduces a new bracket type and the student extends their implementation without restarting.

**Evaluation**
Test execution on both the base and extended versions. The mid-quest extension tests whether the student generalised or hard-coded.

---

### T4 - Recursion *(pivot topic)*

**Content covered**
- Base case and recursive case
- Stack frames and call depth
- Tracing multi-branch recursion
- Recursion vs iteration: when each is appropriate
- Stack overflow and its cause

**Questions**
- MCQ: identify the missing base case
- Trace: `factorial(4)` frame by frame
- Predict: output of a two-branch recursive function
- Explain: why a missing base case causes overflow, in stack terms

**Practical - "Descent"** (code + hand-trace submission)
Write a recursive tree-depth function, then hand-trace it on a supplied tree and submit the trace alongside the code.

**Boss Checkpoint - "Two Paths"**
Convert an iterative function to recursive and demonstrate equivalence on three supplied inputs. No hints, single attempt.

**Evaluation**
Code correctness by test execution; trace correctness against generated reference trace; equivalence argument graded as free text. Boss checkpoint requires all three to pass and is gated on mastery from C1.

---

### T5 - Trees & Binary Search Trees

**Content covered**
- Tree terminology: root, leaf, height, depth, subtree
- Traversals: in-order, pre-order, post-order
- The BST invariant
- Search, insert, and delete cost
- Degradation to a linked list on sorted input

**Questions**
- MCQ: which traversal produces sorted output from a BST
- Trace: in-order traversal of a supplied tree
- Predict: insertion position for a new value
- Explain: why sorted insertion order degrades a BST to O(n)

**Practical - "Skew"** (comparative analysis + debugging)
Build a BST from two different insertion orders of the same values, compare resulting heights, and explain the difference.

**Boss Checkpoint - "Rebuild"**
Given a degenerate BST, propose and justify a fix; implement the corrected insertion order.

**Evaluation**
Structural correctness of both trees (deterministic) + explanation of the degradation mechanism (NLI-verified grading rationale).

---

### T6 - Hashing

**Content covered**
- Hash functions and uniform distribution
- Collisions and why they are unavoidable
- Chaining vs open addressing
- Load factor and its effect on lookup cost

**Questions**
- MCQ: expected lookup cost at a stated load factor
- Trace: place four keys into a table by hand, showing collisions
- Predict: which two keys collide for a given hash function
- Explain: why performance degrades as load factor approaches 1

**Practical - "Collision Course"** (code completion)
Implement chaining, then measure and report lookup cost as the table fills toward capacity.

**Evaluation**
Implementation correctness by test execution + interpretation of the measured results as free text.

---

### T7 - Sorting & Divide-and-Conquer

**Content covered**
- Quadratic sorts and why they are quadratic
- Merge sort: divide, conquer, combine
- The divide-and-conquer pattern as a general strategy
- Stability and when it matters
- Reading the recursion tree to get O(n log n)

**Questions**
- MCQ: identify which sort a partial trace came from
- Trace: one merge step on two sorted halves
- Predict: comparison count for a small input
- Explain: how the recursion tree yields n log n

**Practical - "Merge"** (code + hand-trace)
Implement merge sort, then explain the complexity by reference to the recursion tree.

**Module Boss Checkpoint - "The Brief"**
A stated real-world problem. Choose an appropriate data structure and algorithm, justify the choice against complexity requirements, and implement the core operation. Requires retrieval across multiple topics and generation grounded in multiple chunks - the primary showcase for multi-chunk NLI-gated generation.

**Evaluation**
Implementation correctness + justification graded against retrieved material from T1, T5, and T7. Unlocking requires mastery thresholds met across all prerequisite topics.

---

## 5. Evaluation model

### 5.1 Per-question evaluation

| Answer type | Grading path | Faithfulness gate applies to |
|---|---|---|
| MCQ | Deterministic key match | The generated stem, options, and stated answer |
| Trace | Compared against generated reference trace | The reference trace and the feedback |
| Predict | Deterministic + generated explanation | The explanation |
| Free text | LLM auto-grader against retrieved reference | The grading rationale |
| Code | Test execution + LLM rationale | The rationale, not the test result |

**Key point for the panel:** the gate does not verify whether the student is right - it verifies that the *tutor's explanation of why* is grounded in the course material. An invented rubric criterion or a fabricated justification misinforms the student about their own competence, which is why grading is treated as a faithfulness problem.

### 5.2 Progression and unlocking

- **XP** awarded per checkpoint passed, not per session completed
- **Badges** unlocked on mastery thresholds from C1, not on point totals
- **Quests** - a topic's practical unlocks when all its checkpoints pass
- **Boss checkpoints** unlock on mastery across all prerequisite topics
- **MCQ performance does not gate anything** - recall check only

### 5.3 Session exits

Every session terminates in a labelled state: `completed`, `mastery-satisfied`, `struggling`, `load-exit`, `student-ended`, or `timeout`. Struggling exits (three failures on the same checkpoint) hand back to C1 for weak-prerequisite routing. Load exits, student exits, and timeouts are resumable within 24–48 hours from the last passed checkpoint.

### 5.4 Research evaluation using this content

| Measured | Using |
|---|---|
| Hallucination rate, gate on vs off | Generated units, practicals, and grading rationale across all 7 topics |
| Claim-level vs whole-response verification | Long-form outputs: boss checkpoint scenarios, multi-criterion grading |
| Load-adaptation accuracy | Explanation depth for the same unit under different load labels |
| Learning gain, mastery-gated vs points-only | Pre/post test per topic across the two gamification conditions |

Boss checkpoints and comparative-analysis practicals produce the longest generated outputs in the module, which is where claim-level verification is expected to outperform whole-response checking most clearly.
