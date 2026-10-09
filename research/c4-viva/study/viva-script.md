# Viva script (PP1 pilot)

Read this the same way, in the same order, for every student. Questions come from the AdaptLearn
DSA seed concepts (`database/seed/concepts_dsa.csv`) and C3's Stacks and Queues topic plan
(`docs/c3/dsa-module-plan.md`). Ask a lecturer to check them before the first session.

## Rules for you (the examiner)

- Start the Zoom recording **after** both of you (and the observer) have joined, just before
  the warm-up or question 1. Say the participant code aloud: "Participant P03."
- Read each question exactly as written, at a calm pace.
- **Stay silent while the student thinks or pauses.** No "mm-hm", no hints, no finishing their
  sentences. Talking during their pauses shortens the pauses you are measuring.
- If the student is silent for about 20 seconds, say only: "Take your time."
- Ask at most **one follow-up** per question, chosen by the rule below.
- Do not say whether an answer is right or wrong. After each answer say "Thank you." and move
  on.

## The follow-up rule (the same for everyone)

| The answer was | You say |
|---|---|
| Complete (has the "complete answer" points) | "Thank you." Next question. |
| Partly right, or too short | Follow-up **A** |
| Wrong, or "I don't know", or still silent after "Take your time" | Follow-up **B** |

After the follow-up answer, say "Thank you." and go to the next question.

## Opening (not recorded)

"Thank you for taking part. This is a short practice viva on data structures with five
questions. Please answer in English as you would in a real viva. There are no marks and it
does not affect your grades. [Observer] is here to take notes. Is that okay? I will start the
recording now."

## Warm-up (optional, recorded, not marked)

"Before we start, tell me briefly about your degree and why you chose it."

## Questions

### Question 1: Stacks (`dsa.stack`)

**Ask:** "What is a stack, and how do the push and pop operations work?"

Complete answer: last in, first out; push adds an item to the top; pop removes the item from
the top.

- **A:** "If you push A, then B, then C onto a stack, which item does pop return first, and why?"
- **B:** "Think of a pile of plates. Which plate do you take first, and how is that like a stack?"

### Question 2: Queues (`dsa.queue`)

**Ask:** "What is a queue, and how is it different from a stack?"

Complete answer: first in, first out; enqueue adds at the rear, dequeue removes from the front;
a stack removes the newest item first.

- **A:** "If print jobs A, B and C arrive in that order, which job is printed first, and why?"
- **B:** "Think of people waiting in a line at a bank counter. Who is served first?"

### Question 3: Why a stack for undo (`dsa.stack`, application)

**Ask:** "Why would a text editor use a stack, and not a queue, for its undo feature?"

Complete answer: undo must reverse the most recent change first, which is last in, first out; a
queue would undo the oldest change first.

- **A:** "If you type three words and press undo once, which word should disappear?"
- **B:** "When you press undo, do you expect your newest change or your oldest change to be removed?"

### Question 4: The call stack (`dsa.call_stack`)

**Ask:** "When a method calls another method, how does the program remember where to continue
afterwards? What is the call stack?"

Complete answer: each call pushes a frame (local variables and the return point) onto the call
stack; when the method returns, its frame is popped and execution continues in the caller.

- **A:** "If method A calls B, and B calls C, which method finishes first, and why?"
- **B:** "When a method finishes, where does the program go back to?"

### Question 5: Arrays vs linked lists (`dsa.array_costs`, `dsa.linked_list`)

**Ask:** "Why is inserting an element at the start of an array slow, while it can be fast in a
linked list?"

Complete answer: array elements are stored next to each other, so every element must shift one
place (linear time); a linked list only creates a node and changes the head pointer (constant
time).

- **A:** "What has to happen to the existing elements when you insert at index zero of an array?"
- **B:** "In a linked list, how is each element connected to the next one?"

## Closing

"That is the end of the viva. Thank you." Stop the recording, then (optional) ask the two
self-rating questions from `google-form.md`, section 5.

Timing: about 10 minutes for the five questions.
