---
concept_id: prog.variables_types
module: prog
sequence: 2
topic: Basics
title: "2. Variables and Data Types"
prerequisites: [prog.java_intro]
cross_module_prerequisites: []
difficulty: 1
java_version: 21
version: 1
status: draft
---

# 2. Variables and Data Types

<!-- section: objectives -->
## Learning Objectives

After this concept you should be able to:

1. Declare, initialise and reassign variables of the common Java types.
2. Choose an appropriate type (`int`, `long`, `double`, `char`, `boolean`, `String`) for a value.
3. Name variables following Java's rules and conventions.
4. Predict the result of widening conversions and explicit casts.
5. Recognise integer overflow and floating-point imprecision.

<!-- section: prerequisites -->
## Before You Start

From **Introduction to Java** you should be able to write a program with a `main` method, print with `System.out.println`, join strings with `+`, and read input with `Scanner`.

<!-- section: theory -->
## Theory

### What a Variable Is

A **variable** is a named location in memory that holds a value. Every variable in Java has three properties:

- a **name**, used to refer to it,
- a **type**, which fixes what kind of values it can hold,
- a **value**, which can change while the program runs.

Java is **statically typed**: the type of a variable is fixed when it is declared and cannot change later.

<!-- section: theory -->
### Declaring, Initialising and Assigning

```java
int count;        // declaration: creates a variable named count of type int
count = 5;        // assignment: stores 5 in count
int total = 10;   // declaration with initialisation in one statement
total = total + count;   // reassignment: total now holds 15
```

The `=` symbol is the **assignment operator**. It means "evaluate the right-hand side, then store the result in the variable on the left". It does not mean mathematical equality, which is why `total = total + count` makes sense: the old value of `total` is used to compute the new one.

A local variable must be given a value before it is used. Reading a variable that has been declared but never assigned is a **compile-time error**.

<!-- section: theory -->
### Naming Rules and Conventions

**Rules** (breaking them is a compile-time error):

- Names may contain letters, digits, `_` and `$`.
- Names must not start with a digit.
- Names must not be a Java keyword such as `int`, `class` or `public`.
- Names are case-sensitive: `age` and `Age` are different variables.

**Conventions** (followed by all professional Java code):

- Variables use **camelCase**: `studentName`, `totalMarks`.
- Constants use **UPPER_SNAKE_CASE**: `MAX_STUDENTS`.
- Names describe their purpose: `marks` rather than `m`.

<!-- section: theory -->
### Primitive Types

Java has eight **primitive types**. These six are used throughout this course:

| Type | Holds | Size | Example literal |
|---|---|---|---|
| `int` | Whole numbers from about -2.1 billion to 2.1 billion | 32 bits | `42`, `-7` |
| `long` | Very large whole numbers | 64 bits | `9000000000L` |
| `double` | Decimal numbers | 64 bits | `3.14`, `-0.5` |
| `float` | Decimal numbers with less precision | 32 bits | `3.14f` |
| `char` | A single character | 16 bits | `'A'`, `'7'`, `'#'` |
| `boolean` | `true` or `false` | | `true` |

The remaining two, `byte` and `short`, are smaller whole-number types used mainly to save memory.

Use `int` for counts and whole numbers, `double` for measurements and money calculations in simple programs, `boolean` for yes/no facts, and `char` for a single character. A `long` literal needs an `L` suffix, and a `float` literal needs an `f` suffix.

<!-- section: theory -->
### String

`String` holds a sequence of characters, such as a name or a sentence. String literals use **double quotes**: `"Colombo"`. `String` is not a primitive type; it is a class, which is why it starts with a capital letter. You will see what that means in the concept on classes and objects.

Two useful operations for now:

- `s.length()` returns the number of characters in `s`.
- `s.charAt(i)` returns the character at position `i`, counting from `0`.

A `char` uses **single quotes** and holds exactly one character; a `String` uses **double quotes** and can hold any number, including zero. `'A'` and `"A"` are different types.

To read a single character with `Scanner`, read a word and take its first character: `char c = sc.next().charAt(0);`

<!-- section: theory -->
### Constants

A variable declared with the keyword `final` cannot be reassigned after it is given a value. It is a **constant**.

```java
final double PI = 3.14159;
final int MAX_STUDENTS = 40;
```

Trying to assign a new value to a `final` variable is a compile-time error. Constants make programs easier to read and change, because a meaningful name replaces a bare number.

<!-- section: theory -->
### Type Conversion

**Widening** conversion happens automatically when a value moves to a type that can represent it without loss, such as `int` to `double`:

```java
int whole = 7;
double d = whole;     // d holds 7.0
```

**Narrowing** conversion could lose information, so Java requires an explicit **cast**, written as the target type in parentheses:

```java
double price = 9.99;
int rounded = (int) price;   // rounded holds 9
```

Casting a `double` to an `int` **truncates**: it removes the fractional part and does not round. `(int) 9.99` is `9` and `(int) -2.7` is `-2`.

Characters are stored as numbers (their Unicode code). Casting between `char` and `int` exposes this: `(int) 'A'` is `65`, and `(char) 66` is `'B'`.

<!-- section: theory -->
### Integer Overflow

An `int` can only hold values up to `Integer.MAX_VALUE`, which is 2147483647. Arithmetic that goes past this limit does not produce an error. The value **wraps around** to the most negative `int`, `Integer.MIN_VALUE`, which is -2147483648. This is called **overflow**. When values may exceed about two billion, use `long`.

<!-- section: theory -->
### Floating-Point Imprecision

A `double` stores most decimal fractions approximately, because it uses binary. For example, `0.1 + 0.2` evaluates to `0.30000000000000004` rather than exactly `0.3`. This is normal behaviour of floating-point arithmetic, not a bug in Java. For this reason, comparing two `double` values for exact equality is unreliable.

<!-- section: example -->
## Worked Examples

### Example 1: Declaring and Printing Variables

```java
public class Main {
    public static void main(String[] args) {
        int age = 19;
        double gpa = 3.61;
        char grade = 'A';
        boolean enrolled = true;
        String name = "Dilini";
        final int MAX_CREDITS = 30;

        System.out.println(name + " is " + age + " years old.");
        System.out.println("GPA: " + gpa + ", grade: " + grade);
        System.out.println("Enrolled: " + enrolled);
        System.out.println("Name length: " + name.length());
        System.out.println("First letter: " + name.charAt(0));
        System.out.println("Max credits: " + MAX_CREDITS);
    }
}
```

```output
Dilini is 19 years old.
GPA: 3.61, grade: A
Enrolled: true
Name length: 6
First letter: D
Max credits: 30
```

<!-- section: example -->
### Example 2: Reassignment and Conversion

```java
public class Main {
    public static void main(String[] args) {
        int x = 10;
        x = x + 5;
        double d = x;
        double price = 7.89;
        int truncated = (int) price;
        int code = (int) 'A';
        char next = (char) (code + 1);

        System.out.println(x);
        System.out.println(d);
        System.out.println(truncated);
        System.out.println(code);
        System.out.println(next);
    }
}
```

```output
15
15.0
7
65
B
```

**Trace:**

| Line | x | d | price | truncated | code | next |
|---|---|---|---|---|---|---|
| `int x = 10;` | 10 | | | | | |
| `x = x + 5;` | 15 | | | | | |
| `double d = x;` | 15 | 15.0 | | | | |
| `double price = 7.89;` | 15 | 15.0 | 7.89 | | | |
| `int truncated = (int) price;` | 15 | 15.0 | 7.89 | 7 | | |
| `int code = (int) 'A';` | 15 | 15.0 | 7.89 | 7 | 65 | |
| `char next = (char) (code + 1);` | 15 | 15.0 | 7.89 | 7 | 65 | B |

Notice that `d` prints as `15.0`: a `double` always shows a decimal point.

<!-- section: example -->
### Example 3: Overflow and Floating-Point Imprecision

```java
public class Main {
    public static void main(String[] args) {
        int big = Integer.MAX_VALUE;
        System.out.println(big);
        big = big + 1;
        System.out.println(big);

        long safe = 2147483647L + 1;
        System.out.println(safe);

        System.out.println(0.1 + 0.2);
    }
}
```

```output
2147483647
-2147483648
2147483648
0.30000000000000004
```

Adding 1 to the largest `int` wraps to the smallest `int` with no error. Using `long` avoids the problem. The last line shows that decimal fractions are stored approximately.

<!-- section: misconception -->
## Common Misconceptions

**"`=` means the two sides are equal."**
`=` is assignment: it computes the right-hand side and stores it on the left. Equality is tested with `==`, covered in the next concept.

**"`(int) 3.9` rounds to 4."**
A cast to `int` truncates toward zero. `(int) 3.9` is `3`.

**"`'A'` and `"A"` are the same."**
`'A'` is a `char`, one character. `"A"` is a `String` that happens to contain one character. They are different types.

**"A variable can change its type later."**
Java is statically typed. A variable declared as `int` stays an `int`. You can convert its value into a new variable of another type, but the original variable's type never changes.

**"An unassigned local variable starts at 0."**
Local variables have no default value. Using one before assigning it is a compile-time error.

**"If a number is too large, Java reports an error."**
Integer overflow happens silently. The value wraps around.

**"`0.1 + 0.2` is exactly `0.3` in Java."**
It is `0.30000000000000004`, because `double` values are stored in binary and most decimal fractions are approximations.

<!-- section: facts -->
## Key Facts

- A variable has a name, a type and a value.
- Java is statically typed: a variable's type cannot change after declaration.
- `=` is the assignment operator; it stores the value of the right-hand side in the variable on the left.
- Using a local variable before assigning it a value is a compile-time error.
- Variable names cannot start with a digit and cannot be keywords.
- Java convention is camelCase for variables and UPPER_SNAKE_CASE for constants.
- `int` is a 32-bit whole-number type with a maximum value of 2147483647.
- `long` is a 64-bit whole-number type; `long` literals end in `L`.
- `double` holds decimal numbers.
- `char` holds a single character and uses single quotes.
- `boolean` holds only `true` or `false`.
- `String` holds text, uses double quotes, and is a class, not a primitive type.
- `s.length()` gives the number of characters in a String; `s.charAt(i)` gives the character at index `i`, starting from 0.
- A variable declared `final` cannot be reassigned.
- Widening conversions such as `int` to `double` happen automatically.
- Narrowing conversions such as `double` to `int` require an explicit cast.
- Casting a `double` to an `int` truncates the fractional part; it does not round.
- A `char` is stored as a number: `(int) 'A'` is 65.
- Integer overflow wraps around silently.
- `double` arithmetic is approximate: `0.1 + 0.2` is `0.30000000000000004`.

<!-- section: exercise -->
## Practice Questions

### Level 1: Recall (MCQ)

**Q1.** Which is a valid variable name in Java?
A. `2ndPlace`  B. `class`  C. `studentCount`  D. `total marks`

**Q2.** Which type is most appropriate for storing whether a student has paid their fees?
A. `int`  B. `char`  C. `String`  D. `boolean`

**Q3.** What is the value of `(int) 8.99`?
A. 8  B. 9  C. 8.99  D. A compile-time error

**Q4.** Which statement causes a compile-time error?
A. `double d = 5;`  B. `int i = 5.5;`  C. `char c = 'x';`  D. `long n = 5L;`

### Level 2: Trace and Predict

**Q5.** What does this program print?

```java
public class Main {
    public static void main(String[] args) {
        int a = 4;
        int b = a;
        a = a + 3;
        b = b * 2;
        double c = a;
        System.out.println(a + " " + b + " " + c);
    }
}
```

**Q6.** What does this program print?

```java
public class Main {
    public static void main(String[] args) {
        char c = 'D';
        int n = (int) c;
        char back = (char) (n - 3);
        String word = "Kandy";
        System.out.println(n);
        System.out.println(back);
        System.out.println(word.charAt(word.length() - 1));
    }
}
```

### Level 3: Explain

**Q7.** A student stores a population count of 3,000,000,000 in an `int` and finds a negative number printed. Explain why this happens and how to fix it.

**Q8.** Explain the difference between `char grade = 'A';` and `String grade = "A";`.

### Level 4: Implement

**Q9. Whole and Fraction.** Read one decimal number. Print its whole-number part (using a cast) on the first line and the original number on the second line.

Sample input:

```text
12.75
```

Sample output:

```text
12
12.75
```

**Q10. Swap.** Read two whole numbers `a` and `b`. Swap their values using a third variable, then print `a = <a>, b = <b>` after the swap.

Sample input:

```text
3 8
```

Sample output:

```text
a = 8, b = 3
```

### Level 5: Challenge

**Q11. Character Neighbours.** Read a single character. Print three lines: its numeric code, the character before it, and the character after it, in this format:

```text
Code: <code>
Before: <char>
After: <char>
```

Sample input:

```text
m
```

Sample output:

```text
Code: 109
Before: l
After: n
```

<!-- section: solution -->
## Solutions

**Q1.** C. A starts with a digit, B is a keyword, D contains a space.

**Q2.** D. The fact is either true or false.

**Q3.** A. Casting truncates the fractional part.

**Q4.** B. `5.5` is a `double`, and assigning it to an `int` is a narrowing conversion that needs an explicit cast.

**Q5.**

```output
7 8 7.0
```

`b` is assigned `4` from `a` before `a` changes, so `b` becomes `8` and `a` becomes `7`. `c` is `7.0` because it is a `double`.

**Q6.**

```output
68
A
y
```

`'D'` has code 68. `68 - 3` is 65, which is `'A'`. `"Kandy"` has length 5, so the last character is at index 4, which is `'y'`.

**Q7.** An `int` can hold at most 2147483647. The value 3,000,000,000 is larger, so the stored value overflows and wraps around into the negative range. No error is reported because overflow is silent. The fix is to use `long` and write the literal with an `L` suffix: `long population = 3000000000L;`

**Q8.** `'A'` is a `char`: exactly one character, stored as a number (65), written with single quotes. `"A"` is a `String`: a sequence of characters that happens to have length 1, written with double quotes. They are different types, so they cannot be used interchangeably; for example `"A".length()` is valid but `'A'.length()` is not.

**Q9.**

```java
import java.util.Scanner;

public class Main {
    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        double x = sc.nextDouble();
        int whole = (int) x;
        System.out.println(whole);
        System.out.println(x);
    }
}
```

```input
12.75
```

```output
12
12.75
```

**Q10.**

```java
import java.util.Scanner;

public class Main {
    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        int a = sc.nextInt();
        int b = sc.nextInt();
        int temp = a;
        a = b;
        b = temp;
        System.out.println("a = " + a + ", b = " + b);
    }
}
```

```input
3 8
```

```output
a = 8, b = 3
```

Without `temp`, writing `a = b;` first would destroy the original value of `a`.

**Q11.**

```java
import java.util.Scanner;

public class Main {
    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        char c = sc.next().charAt(0);
        int code = (int) c;
        System.out.println("Code: " + code);
        System.out.println("Before: " + (char) (code - 1));
        System.out.println("After: " + (char) (code + 1));
    }
}
```

```input
m
```

```output
Code: 109
Before: l
After: n
```

<!-- section: rubric -->
## Marking Rubrics

**Q7 (Explain, 3 marks)**
- 1 mark: states that `int` has a maximum value of about 2.1 billion (2147483647).
- 1 mark: states that exceeding it causes overflow that wraps to negative values without an error.
- 1 mark: states the fix of using `long` with an `L` literal suffix.

**Q8 (Explain, 2 marks)**
- 1 mark: `char` holds exactly one character and uses single quotes.
- 1 mark: `String` holds a sequence of characters, uses double quotes, and is a different type.

**Q9 to Q11 (Implement and Challenge)**
- Output matches exactly on all hidden tests: full marks.
- Q9 must use a cast, not rounding functions. Q10 must swap using a temporary variable, not by printing in reverse order. Q11 must derive the neighbouring characters by arithmetic on the character code.

<!-- section: further_practice -->
## Further Practice

- HackerRank, Java: *Java Datatypes* (https://www.hackerrank.com/challenges/java-datatypes/problem)
- HackerRank, Java: *Java Int to String* (https://www.hackerrank.com/challenges/java-int-to-string/problem)
- LeetCode 2235: *Add Two Integers* (https://leetcode.com/problems/add-two-integers/)
