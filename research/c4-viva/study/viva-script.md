**Viva script — PP1 pilot: Programming Fundamentals**

**Instructions for the examiner**

- Ask the five main questions in the same order.
- Read only the questions aloud. Expected answers are for the examiner.
- Accept correct explanations in the student’s own words.
- If the answer is complete, say **“Thank you”** and move on.
- If the answer is partly correct or needs more explanation, ask **Follow-up B**.
- If the answer is incorrect or the student says “I don’t know,” ask **Follow-up C**.
- Ask only **one follow-up per main question**, then move on.
- Stay quiet while the student thinks. After about 20 seconds of silence, say **“Take your time.”**
- Do not explain the answer, give hints, or say whether the response is correct during the session.
- Paste each main question, and any code or values, into the Zoom chat as you ask it (`viva-cards.md`), so every student sees the same text.

**Opening — before recording**

“Thank you for taking part. This is a short practice viva with five programming questions. There are no marks, and it will not affect your grades. Please explain your answers in English, using your own words. It is okay to pause or say you do not know.

With your permission, I would like to record the session for the research. The observer will take notes. Are you comfortable with this?”

After consent, start recording and say the participant code.

**Warm-up (always ask it, first, for every student)**

“Tell me briefly about your degree and why you chose it.”

---

**Question 1: Variables and data types**  
Concept: `prog.variables_types`

**Viva question to ask**

“What is a variable used for in a program? What kinds of values can an integer, a float, a boolean, and a string store? Give at least one example.”

**Expected answer — examiner only**

A variable stores or refers to a value using a name.

- An integer stores a whole number, such as `7`.
- A float represents a floating-point number, such as `7.5`.
- A boolean represents `True` or `False`.
- A string stores text, such as `"Hello"` or `"7"`.

**Follow-up B — partly correct or incomplete**

“What is the difference between `7`, `7.5`, and `"7"` with quotation marks?”

**Expected answer**

`7` is an integer, `7.5` is a float, and `"7"` is a string. Although `"7"` looks like a number, it is stored as text.

**Follow-up C — incorrect or no answer**

“Suppose a program needs to remember a student’s age. How could you store that age in a variable?”

**Expected answer**

For example, `age = 20`. The variable is named `age`, and it stores the value `20`, which is an integer.

---

**Question 2: Conditionals**  
Concept: `prog.conditionals`

**Viva question to ask**

“A program checks these rules in order:

- If the mark is 75 or more, give grade A.
- Otherwise, if the mark is 65 or more, give grade B.
- Otherwise, give grade C.

A student gets 72. Which grade will the program give? Explain how it chooses.”

**Expected answer — examiner only**

The grade is **B**.

The program checks the conditions from top to bottom. The first condition is false because 72 is below 75. The second condition is true because 72 is at least 65.

Only the first matching branch runs. The final `else` runs only when neither earlier condition is true.

**Follow-up B — partly correct or incomplete**

“Once one rule matches and gives a grade, does the program still check the other rules? Why?”

**Expected answer**

No. Only the first matching branch runs; the remaining branches are skipped.

**Follow-up C — incorrect or no answer**

“Using the same rules, what grade would a student with 50 receive? Why?”

**Expected answer**

Grade **C**, because 50 does not satisfy either earlier condition, so the final `else` runs.

---

**Question 3: Loops**  
Concept: `prog.loops`

**Viva question to ask**

“When would you use a for loop, and when would you use a while loop?”

**Expected answer — examiner only**

A `for` loop is commonly used to repeat something a known number of times or to go through a collection of items.

A `while` loop repeats while a condition is true. It is useful when the number of repetitions depends on something happening.

**Follow-up B — partly correct or incomplete**

“What happens if a while loop’s condition stays true and nothing else stops the loop?”

**Expected answer**

It keeps repeating. This is called an **infinite loop**. A while loop stops only when its condition becomes false or a `break` ends it.

**Follow-up C — incorrect or no answer**

“A program keeps asking for a password until the correct password is entered. Which loop would you normally use, and when should it stop?”

**Expected answer**

A `while` loop is suitable. It repeats while the password is incorrect and stops when the correct password is entered.

**Marking note**

Do not mark an answer wrong just because the student explains another valid loop implementation. Judge whether their reasoning is correct.

---

**Question 4: Functions and parameters**  
Concept: `prog.functions`

**Viva question to ask**

“What is the difference between defining a function and calling it?”

**Expected answer — examiner only**

Defining a function gives it a name, parameters, and a body of code. Its body does not run just because it has been defined.

Calling the function runs its body, with the arguments passed to its parameters.

**Follow-up B — partly correct or incomplete**

“If I define a function but never call it, will the code inside its body run? Why?”

**Expected answer**

No. Defining only creates the function and gives it a name. The body runs only when the function is called.

**Follow-up C — incorrect or no answer**

“A function is defined as `def area(w, h):`. If I call `area(5, 2)`, what value goes into `w`, and what value goes into `h`?”

**Expected answer**

`w` receives `5`, and `h` receives `2`: the arguments match the parameters in order.

---

**Question 5: Return values and printing**  
Concept: `prog.return_values_scope` — return/print only; scope is not assessed in this revised question.

**Viva question to ask**

“What is the difference between using `return` and using `print` inside a Python function?”

**Expected answer — examiner only**

`return` sends a value back to the code that called the function. That code can store the value or use it in another calculation.

`print` displays a value on the screen. Printing a value does not return that value to the calling code.

**Follow-up B — partly correct or incomplete**

“If a function prints an answer on the screen, does that mean it also returns that answer? Why?”

**Expected answer**

No. Printing only displays the answer; the calling code does not get it. To give the answer back, the function must use `return`. (Bonus, not required: a function with no `return` gives back `None`.)

**Follow-up C — incorrect or no answer**

“If another part of the program needs to use a function’s calculated answer, should the function print it or return it? Why?”

**Expected answer**

It should **return** the answer, so the calling code can store it or use it in another calculation.

---

**Closing**

“That is the end of the viva. Thank you for taking part.”

Stop the recording. Ask any planned self-rating questions afterward.
