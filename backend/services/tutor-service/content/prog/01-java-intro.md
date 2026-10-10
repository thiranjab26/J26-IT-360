---
concept_id: prog.java_intro
module: prog
sequence: 1
topic: Getting Started
title: "1. Introduction to Java"
prerequisites: []
cross_module_prerequisites: []
difficulty: 1
java_version: 21
version: 1
status: draft
---

# 1. Introduction to Java

<!-- section: objectives -->
## Learning Objectives

After this concept you should be able to:

1. Describe how a Java program goes from source code to running program, using the terms JDK, compiler, bytecode and JVM.
2. Write a complete Java program with a correctly named class and a `main` method.
3. Print text using `System.out.println` and `System.out.print`, including escape sequences.
4. Read numbers and text from the keyboard using `Scanner`.
5. Distinguish compile-time errors, runtime errors and logic errors.

<!-- section: prerequisites -->
## Before You Start

This is the first concept. You need no programming experience, only a working JDK 21 installation as described in the module introduction.

<!-- section: theory -->
## Theory

### What a Program Is

A computer can only perform very simple operations: store a value, add two numbers, compare two values, jump to another instruction. A **program** is a sequence of such instructions that together solve a problem. A **programming language** lets us write those instructions in a form people can read, which is then translated into a form the machine can execute.

Java is a **high-level language**: it uses words and symbols close to English and mathematics rather than raw machine instructions.

<!-- section: theory -->
### From Source Code to Running Program

Running a Java program is a two-step process.

1. **Compile.** You write **source code** in a file ending in `.java`. The Java compiler, `javac`, checks the code for errors and translates it into **bytecode**, stored in a file ending in `.class`.
2. **Run.** The **Java Virtual Machine (JVM)**, started with the `java` command, loads the bytecode and executes it.

```text
Main.java  --javac-->  Main.class  --java-->  program runs
(source)               (bytecode)             (on the JVM)
```

Because bytecode runs on the JVM rather than directly on the processor, the same `.class` file runs on Windows, macOS and Linux without recompiling. This is summarised as *write once, run anywhere*.

In a terminal, the two steps look like this:

```text
javac Main.java
java Main
```

Notice that `javac` takes the file name including `.java`, while `java` takes only the class name.

<!-- section: theory -->
### JDK, JRE and JVM

| Name | What it is |
|---|---|
| **JVM** (Java Virtual Machine) | The program that executes bytecode |
| **JRE** (Java Runtime Environment) | The JVM plus the standard libraries needed to *run* Java programs |
| **JDK** (Java Development Kit) | The JRE plus development tools such as the compiler `javac`. Needed to *write* Java programs |

As a developer you install the JDK, which contains everything else.

<!-- section: theory -->
### The Structure of a Java Program

Every Java program in this course has this shape:

```java
public class Main {
    public static void main(String[] args) {
        System.out.println("Hello, world!");
    }
}
```

Read it from the outside in:

- `public class Main { ... }` declares a **class** named `Main`. All Java code lives inside classes. The braces `{` and `}` mark where the class begins and ends.
- `public static void main(String[] args) { ... }` declares the **main method**, the **entry point** of the program. When you run `java Main`, the JVM looks for exactly this method and starts executing the statements inside it, from top to bottom.
- `System.out.println("Hello, world!");` is a **statement**, one instruction. Statements end with a semicolon.

Two rules are strict:

- **A public class must be saved in a file with the same name.** `public class Main` must be in `Main.java`. Otherwise the program does not compile.
- **Java is case-sensitive.** `Main`, `main` and `MAIN` are three different names. `system.out.println` does not compile; it must be `System`.

The words `public`, `static`, `void` and `String[] args` each have precise meanings that you will learn in the concepts on methods and on classes and objects. For now, treat the first two lines as required structure and write them exactly.

<!-- section: theory -->
### Statements, Blocks and Whitespace

A **statement** is a single instruction and ends with `;`. A **block** is a group of statements enclosed in braces `{ }`. The body of a class and the body of a method are blocks.

Java ignores extra spaces, tabs and blank lines between tokens, so layout does not change what a program does. It does change how easy the program is to read. The convention is to indent the contents of every block by four spaces, as in all examples in this course.

<!-- section: theory -->
### Printing Output

`System.out.println(x)` prints `x` and then moves to a new line. `System.out.print(x)` prints `x` and stays on the same line.

Text written between double quotes, such as `"Hello"`, is a **string literal**. The `+` operator joins strings together, which is called **concatenation**: `"Total: " + 5` produces `Total: 5`.

Special characters inside a string are written with a backslash, called an **escape sequence**:

| Escape | Meaning |
|---|---|
| `\n` | New line |
| `\t` | Tab |
| `\"` | A double quote character |
| `\\` | A backslash character |

<!-- section: theory -->
### Comments

Comments are notes for human readers. The compiler ignores them completely.

```java
// A single-line comment runs to the end of the line.

/* A multi-line comment
   can span several lines. */

/** A documentation comment describes a class or method. */
```

<!-- section: theory -->
### Reading Input with Scanner

To read from the keyboard, Java provides the `Scanner` class in the package `java.util`. Using it takes three steps:

1. **Import it** at the top of the file: `import java.util.Scanner;`
2. **Create a Scanner** connected to standard input: `Scanner sc = new Scanner(System.in);`
3. **Call a reading method** for each value you need.

| Method | Reads |
|---|---|
| `nextInt()` | The next whole number |
| `nextDouble()` | The next decimal number |
| `next()` | The next word, stopping at a space or newline |
| `nextLine()` | Everything up to the end of the current line |

`nextInt()`, `nextDouble()` and `next()` skip leading spaces and newlines, then read one token. They leave the rest of the line, including the newline character, unread. `nextLine()` reads up to and including the next newline. This difference causes a well-known trap, covered in the misconceptions below.

<!-- section: theory -->
### Three Kinds of Error

| Kind | When it appears | Example |
|---|---|---|
| **Compile-time error** | When running `javac`. No `.class` file is produced | Missing semicolon, misspelled `System`, class name not matching the file name |
| **Runtime error** | While the program runs. The program stops with an exception | Typing `abc` when `nextInt()` expects a number (`InputMismatchException`) |
| **Logic error** | Never reported. The program runs but produces the wrong result | Printing `"Totla"` instead of `"Total"`, or using the wrong formula |

Compile-time errors are the easiest to fix because the compiler tells you the line. Logic errors are the hardest because nothing tells you they exist; you find them by testing and tracing.

<!-- section: example -->
## Worked Examples

### Example 1: Hello, World

```java
public class Main {
    public static void main(String[] args) {
        System.out.println("Hello, world!");
    }
}
```

```output
Hello, world!
```

The JVM starts at `main`, executes its only statement, reaches the closing brace of `main`, and the program ends.

<!-- section: example -->
### Example 2: print Versus println, and Escape Sequences

```java
public class Main {
    public static void main(String[] args) {
        System.out.print("Java ");
        System.out.print("is ");
        System.out.println("fun.");
        System.out.println("Name:\tAmal");
        System.out.println("She said \"hello\".");
        System.out.println("Line one\nLine two");
    }
}
```

```output
Java is fun.
Name:	Amal
She said "hello".
Line one
Line two
```

**Trace:**

| Statement | Effect |
|---|---|
| `print("Java ")` | Prints `Java ` and stays on the line |
| `print("is ")` | Continues the same line |
| `println("fun.")` | Finishes the line and moves to a new one |
| `println("Name:\tAmal")` | `\t` inserts a tab |
| `println("She said \"hello\".")` | `\"` prints a literal quote |
| `println("Line one\nLine two")` | `\n` breaks the line inside a single statement |

<!-- section: example -->
### Example 3: Reading Input

This program reads a name on the first line and an age on the second, then prints a greeting.

```java
import java.util.Scanner;

public class Main {
    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        String name = sc.nextLine();
        int age = sc.nextInt();
        System.out.println("Hello, " + name + "!");
        System.out.println("Next year you will be " + (age + 1) + ".");
    }
}
```

```input
Nimal Perera
20
```

```output
Hello, Nimal Perera!
Next year you will be 21.
```

`nextLine()` is used for the name because it may contain a space; `next()` would read only `Nimal`. The parentheses around `age + 1` make Java add the numbers before joining the result to the string. Without them, `"... be " + age + 1` would produce `be 201`, because the string is joined with `20` first and then with `1`.

<!-- section: misconception -->
## Common Misconceptions

**"The file can have any name."**
A public class must be in a file with exactly the same name, including capital letters. `public class Main` in `main.java` does not compile.

**"Java runs the .java file directly."**
The source file is first compiled by `javac` into bytecode. The JVM runs the bytecode in the `.class` file, not the source.

**"print and println are the same."**
`println` moves to a new line after printing; `print` does not. Several `print` calls in a row all appear on one line.

**"A missing semicolon is only a warning."**
It is a compile-time error. The program does not compile, so it cannot run at all.

**"`System` and `system` mean the same thing."**
Java is case-sensitive. Only `System` refers to the built-in class.

**"`nextLine()` after `nextInt()` reads the next line of input."**
`nextInt()` reads the number but leaves the newline after it unread. A following `nextLine()` reads that leftover newline and returns an empty string. The usual fix is to call `sc.nextLine();` once after `nextInt()` to consume the rest of that line before reading the next line of text.

**"`"Sum: " + 2 + 3` prints `Sum: 5`."**
Evaluation goes left to right. `"Sum: " + 2` is the string `"Sum: 2"`, and adding `3` gives `"Sum: 23"`. Write `"Sum: " + (2 + 3)` to print `Sum: 5`.

<!-- section: facts -->
## Key Facts

- Java source code is stored in files ending in `.java`.
- The compiler `javac` translates source code into bytecode stored in `.class` files.
- The Java Virtual Machine executes bytecode.
- The JDK includes the compiler; the JRE includes only what is needed to run programs.
- Execution of a Java program starts at the `main` method.
- A public class must be saved in a file with the same name as the class.
- Java is case-sensitive.
- Every statement ends with a semicolon.
- A block is a group of statements enclosed in braces.
- `System.out.println` prints and then moves to a new line; `System.out.print` does not move to a new line.
- The `+` operator joins strings; this is called concatenation.
- `\n` is a newline, `\t` is a tab, `\"` is a double quote, `\\` is a backslash.
- The compiler ignores comments.
- `Scanner` must be imported from `java.util`.
- `nextInt()` leaves the newline after the number unread; `nextLine()` reads up to the end of the line.
- Compile-time errors stop compilation; runtime errors stop a running program; logic errors produce wrong results without any error message.

<!-- section: exercise -->
## Practice Questions

### Level 1: Recall (MCQ)

**Q1.** Which program translates `.java` source code into bytecode?
A. `java`  B. `javac`  C. the JVM  D. the JRE

**Q2.** A file contains `public class Greeter`. What must the file be named?
A. `greeter.java`  B. `Main.java`  C. `Greeter.java`  D. `Greeter.class`

**Q3.** Which statement prints `Hi` and then moves to a new line?
A. `System.out.print("Hi");`  B. `System.out.println("Hi");`  C. `system.out.println("Hi");`  D. `System.out.println(Hi);`

**Q4.** A program compiles and runs without any error message but prints the wrong total. What kind of error is this?
A. Compile-time error  B. Runtime error  C. Logic error  D. Syntax error

### Level 2: Trace and Predict

**Q5.** What does this program print?

```java
public class Main {
    public static void main(String[] args) {
        System.out.print("A");
        System.out.println("B");
        System.out.print("C\n");
        System.out.println("D" + 1 + 2);
        System.out.println("E" + (1 + 2));
    }
}
```

**Q6.** The following program is run with the input shown. What does it print?

```java
import java.util.Scanner;

public class Main {
    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        int n = sc.nextInt();
        String word = sc.nextLine();
        System.out.println("[" + n + "][" + word + "]");
    }
}
```

```input
7
apple
```

### Level 3: Explain

**Q7.** Explain why a compiled Java `.class` file can run on both Windows and Linux without being recompiled.

**Q8.** A student writes `public class Calculator` in a file named `calc.java` and runs `javac calc.java`. Explain what happens and how to fix it.

### Level 4: Implement

**Q9. Receipt Line.** Read an item name (a single line of text) and a whole-number quantity on the next line. Print exactly:

```text
Item: <name>
Quantity: <quantity>
```

Sample input:

```text
Blue Pen
3
```

Sample output:

```text
Item: Blue Pen
Quantity: 3
```

**Q10. Echo Twice.** Read one whole number `n`. Print `n` on one line and `n` doubled on the next line, in the format `n = 5` and `2n = 10`.

### Level 5: Challenge

**Q11. Student Card.** Read three lines: a full name, a student ID (a single word), and a year of study (a whole number). Then print a card exactly like this, where the last line shows the year the student will be in after one more year:

```text
+--------------------+
Name: <full name>
ID: <id>
Year: <year>
Next year: Year <year + 1>
+--------------------+
```

Take care with reading a line of text after a number, and with the arithmetic inside the string.

<!-- section: solution -->
## Solutions

**Q1.** B. `javac` is the compiler.

**Q2.** C. The file name must match the public class name exactly, with the `.java` extension.

**Q3.** B. Option A does not move to a new line, C misspells `System`, and D prints a variable called `Hi` rather than the text.

**Q4.** C. Nothing is reported, but the result is wrong.

**Q5.**

```output
AB
C
D12
E3
```

`"D" + 1` is the string `"D1"`, then `+ 2` gives `"D12"`. In the last line the parentheses force `1 + 2` to be calculated first.

**Q6.**

```output
[7][]
```

`nextInt()` reads `7` but leaves the newline after it unread. `nextLine()` then reads that leftover newline and returns an empty string, so `word` is empty and `apple` is never read.

**Q7.** `javac` compiles source code into bytecode, not into instructions for a specific processor. Bytecode is executed by the JVM, and a JVM exists for each operating system. The same bytecode therefore runs on any system with a JVM.

**Q8.** Compilation fails with an error saying that class `Calculator` is public and should be declared in a file named `Calculator.java`. The fix is to rename the file to `Calculator.java` and compile it with `javac Calculator.java`.

**Q9.**

```java
import java.util.Scanner;

public class Main {
    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        String name = sc.nextLine();
        int quantity = sc.nextInt();
        System.out.println("Item: " + name);
        System.out.println("Quantity: " + quantity);
    }
}
```

```input
Blue Pen
3
```

```output
Item: Blue Pen
Quantity: 3
```

**Q10.**

```java
import java.util.Scanner;

public class Main {
    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        int n = sc.nextInt();
        System.out.println("n = " + n);
        System.out.println("2n = " + (2 * n));
    }
}
```

```input
5
```

```output
n = 5
2n = 10
```

**Q11.** The name is read with `nextLine()`, the ID with `next()`, and the year with `nextInt()`. Because the name is read first, there is no leftover newline problem.

```java
import java.util.Scanner;

public class Main {
    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        String name = sc.nextLine();
        String id = sc.next();
        int year = sc.nextInt();
        System.out.println("+--------------------+");
        System.out.println("Name: " + name);
        System.out.println("ID: " + id);
        System.out.println("Year: " + year);
        System.out.println("Next year: Year " + (year + 1));
        System.out.println("+--------------------+");
    }
}
```

```input
Kasun Silva
IT23000001
2
```

```output
+--------------------+
Name: Kasun Silva
ID: IT23000001
Year: 2
Next year: Year 3
+--------------------+
```

<!-- section: rubric -->
## Marking Rubrics

**Q7 (Explain, 3 marks)**
- 1 mark: states that `javac` produces bytecode rather than processor-specific machine code.
- 1 mark: states that the JVM executes the bytecode.
- 1 mark: states that a JVM is available for each operating system, so the same bytecode runs on each.

**Q8 (Explain, 2 marks)**
- 1 mark: identifies that compilation fails because the public class name does not match the file name.
- 1 mark: gives the fix of renaming the file to `Calculator.java`.

**Q9, Q10 (Implement)**
- Output matches the expected output exactly on all hidden tests: full marks.
- Correct structure (class, `main`, `Scanner` imported and used) but output format differs: partial marks.
- Printing prompts such as `Enter name:` counts as a format error, because the checker compares output exactly.

**Q11 (Challenge)**
- Reads all three values with appropriate `Scanner` methods.
- Calculates `year + 1` numerically, not by string concatenation.
- Produces every line in exactly the required format, including both border lines.

<!-- section: further_practice -->
## Further Practice

- HackerRank, Java: *Welcome to Java!* (https://www.hackerrank.com/challenges/welcome-to-java/problem)
- HackerRank, Java: *Java Stdin and Stdout I* (https://www.hackerrank.com/challenges/java-stdin-and-stdout-1/problem)
- HackerRank, Java: *Java Stdin and Stdout II* (https://www.hackerrank.com/challenges/java-stdin-stdout/problem)
