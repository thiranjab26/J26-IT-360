# Practice viva script (P00 only)

A role-play for a practice run with a friend: your lines and the friend's answers. **Never show
this to a real student**: their answers must be their own. Give the friend only the "Student"
lines. Ask them to say each answer in their own words rather than read it out, because read
speech sounds more fluent than a real answer.

The questions are exactly the ones in `viva-script.md`. In this run, Q3 gets **Follow-up B**;
every other question is answered completely, so it gets no follow-up.

---

## Before recording

**You:** "Thank you for taking part. This is a short practice viva with five programming
questions. There are no marks, and it will not affect your grades. Please explain your answers
in English, using your own words. It is okay to pause or say you do not know.

With your permission, I would like to record the session for the research. The observer will
take notes. Are you comfortable with this?"

**Student:** "Yes."

Click **Record**, then **Record on this computer**.

---

## Recording

**You:** "Participant P00."

### Warm-up

**You:** "Tell me briefly about your degree and why you chose it."

**Student:** "I am doing a degree in Information Technology. I chose it because I like computers
and I want to become a software developer."

**You:** "Thank you."

### Question 1: Variables and data types

Paste the Q1 card into the chat.

**You:** "The first question is: What is a variable used for in a program? What kinds of values
can an integer, a float, a boolean, and a string store? Give at least one example."

**Student:** "A variable is a name that keeps a value, so the program can use it later. An
integer is a whole number, like 7. A float is a number with a decimal point, like 7.5. A
boolean is only True or False. A string is text, like "Hello"."

### Question 2: Conditionals

Paste the Q2 card into the chat.

**You:** "Thank you. The next question is: A program checks these rules in order. If the mark is
75 or more, give grade A. Otherwise, if the mark is 65 or more, give grade B. Otherwise, give
grade C. A student gets 72. Which grade will the program give? Explain how it chooses."

**Student:** "The grade is B. The program checks the rules from the top. 72 is not 75 or more, so
it is not A. Then it checks the next rule: 72 is 65 or more, so it gives B. After that, it stops
checking."

### Question 3: Loops (with Follow-up B)

Paste the Q3 card into the chat.

**You:** "Thank you. The next question is: When would you use a for loop, and when would you use
a while loop?"

**Student** (only partly right, so you ask Follow-up B): "A for loop is used when you know how
many times to repeat, like going through a list. A while loop also repeats, I think."

**You:** "Thank you. What happens if a while loop's condition stays true and nothing else stops
the loop?"

**Student:** "Then it never stops. It keeps repeating forever. This is called an infinite loop.
A while loop only stops when its condition becomes false, or when we use break."

### Question 4: Functions and parameters

Paste the Q4 card into the chat.

**You:** "Thank you. The next question is: What is the difference between defining a function
and calling it?"

**Student:** "Defining a function means writing it: we give it a name, parameters and the code
inside. That code does not run yet. Calling the function means using its name, and then the code
inside runs, with the values we give it."

### Question 5: Return values and printing

Paste the Q5 card into the chat.

**You:** "Thank you. The next question is: What is the difference between using return and using
print inside a Python function?"

**Student:** "Return gives the value back to the code that called the function, so we can save it
or use it again. Print only shows the value on the screen. A printed value is not given back."

### Closing

**You:** "Thank you. That is the end of the viva. Thank you for taking part."

Click **Stop recording**.

---

## What the analysis should show

With `--warmup`, the tool should report the warm-up separately, then 6 viva answers: Q1, Q2, Q3,
Q3 Follow-up B, Q4 and Q5. On paper, write: Q1 none, Q2 none, Q3 B, Q4 none, Q5 none.
