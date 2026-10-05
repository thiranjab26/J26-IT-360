---
module: prog
type: module_introduction
sequence: 0
title: "Programming Fundamentals in Java: Module Introduction"
java_version: 21
version: 1
status: draft
---

# Programming Fundamentals in Java

<!-- section: overview -->
## What This Module Is About

A program is a precise list of instructions that a computer follows. Programming is the skill of breaking a problem into steps small and exact enough that a machine can carry them out without guessing. This module teaches that skill using Java.

By the end of the module you will be able to read a problem, design a step-by-step solution, write it in Java, run it, and trace exactly what it does line by line. Those abilities are the foundation for everything in the Data Structures and Algorithms module that follows.

<!-- section: overview -->
## Why Java

Java is one of the most widely used programming languages in industry and education. It is a good first language for three reasons:

- **It is strict.** Java makes you declare the type of every variable, and it refuses to compile code that mixes types incorrectly. Many mistakes are caught before the program ever runs.
- **It is explicit.** Structure is visible in the code: every block is marked with braces, every statement ends with a semicolon, and every program starts from a clearly named entry point.
- **It scales.** The same language is used for small exercises and large production systems, so nothing you learn here is thrown away later.

This course uses **Java 21**, a long-term support release, and only the standard library.

<!-- section: overview -->
## The Learning Map

The module has 13 concepts grouped into 7 topics. Each concept builds only on concepts that come before it.

| # | Concept | Topic | Builds on |
|---|---|---|---|
| 1 | Introduction to Java | Getting Started | |
| 2 | Variables and data types | Basics | 1 |
| 3 | Operators and expressions | Basics | 2 |
| 4 | Conditionals | Control Flow | 3 |
| 5 | Loops | Control Flow | 4 |
| 6 | Nested loops | Control Flow | 5 |
| 7 | Methods | Methods | 2 |
| 8 | Method call flow and scope | Methods | 7 |
| 9 | Arrays | Arrays | 2, 5 |
| 10 | Iterating over arrays | Arrays | 9 |
| 11 | Classes and objects | Objects | 7 |
| 12 | References | Objects | 9, 11 |
| 13 | Tracing program execution | Program Tracing | 6, 8, 12 |

The path moves from *values* (variables and operators), to *decisions and repetition* (conditionals and loops), to *organisation* (methods), to *collections* (arrays), to *modelling* (classes and objects). It ends with tracing, which combines everything: to trace a real program you must follow loops, method calls, arrays and objects at the same time.

<!-- section: overview -->
## How This Module Connects to Data Structures and Algorithms

Several concepts here are direct prerequisites for concepts in the next module:

| This module | Leads to |
|---|---|
| Loops, nested loops | Big-O and growth rate |
| Iterating over arrays | Array operation costs |
| Classes and objects, references | Linked lists |
| Method call flow and scope | The call stack |
| Conditionals, methods | Base case and recursive case |
| Tracing program execution | Tracing recursion |

If you struggle with a concept in the next module, the tutor may send you back to one of these. That is not a step backwards; it is usually the fastest way forward.

<!-- section: overview -->
## How a Tutoring Session Works

Learning in VeriTutor happens in guided sessions rather than by asking questions into a chat box. In each session the tutor leads:

1. **Hook.** A short, concrete situation that shows why the idea matters.
2. **Teach.** One small unit of theory, with an example.
3. **Checkpoint.** You produce something: trace some code, predict an output, explain a rule, or write a small program.
4. **Feedback.** The tutor checks your answer and explains what was right or wrong.
5. **Branch.** A correct answer moves you on. A wrong answer gets a hint and another attempt. Repeated difficulty leads the tutor to re-teach the part that went wrong, or to suggest a prerequisite to revisit.

You earn experience points for each checkpoint you pass. Badges and quests unlock when you have **demonstrated** understanding of a concept, not simply when you have collected enough points. Quick multiple-choice checks help you gauge yourself but never unlock anything on their own.

Every explanation, practice question and piece of feedback the tutor gives is checked against this course material before you see it. If the tutor cannot support a statement from the material, it does not show it to you.

<!-- section: overview -->
## How to Use Each Concept Document

Every concept document follows the same structure:

| Section | What it gives you |
|---|---|
| Learning Objectives | What you should be able to do afterwards |
| Before You Start | A short recap of the prerequisites |
| Theory | The explanation, one idea at a time |
| Worked Examples | Complete programs with traces and real output |
| Common Misconceptions | Mistakes students often make, and why they are wrong |
| Key Facts | Short statements summarising the concept |
| Practice Questions | Five levels, from recall to challenge |
| Solutions and Rubrics | Reference answers and how answers are judged |
| Further Practice | External problems for extra practice |

Practice questions are graded in five levels:

| Level | Type | What it tests |
|---|---|---|
| 1 | Recall (MCQ) | Do you remember the rule? |
| 2 | Trace and Predict | Can you work out what code does? |
| 3 | Explain | Can you say why, in your own words? |
| 4 | Implement | Can you write a working program? |
| 5 | Challenge | Can you combine ideas to solve a new problem? |

Try each question before reading its solution. Tracing and predicting by hand, before running code, is the habit that separates programmers who understand their code from those who only hope it works.

<!-- section: overview -->
## Setting Up

1. Install a **JDK 21** (for example Eclipse Temurin or Oracle JDK 21).
2. Open a terminal and check the installation:

```text
javac -version
java -version
```

Both should report version 21.

3. Use any editor. Visual Studio Code with the Java extension pack, or IntelliJ IDEA Community Edition, both work well.

<!-- section: overview -->
## A Note on Practice Exercises

In the implementation exercises, your program reads its input from the keyboard (standard input) and prints its result to the screen (standard output). An automatic checker supplies the input and compares your output with the expected output exactly. For that reason, **exercise solutions must not print prompts** such as `Enter a number:`, and must print the output in exactly the format requested.
