---
concept_id: prog.conditionals
module: prog
sequence: 4
topic: Control Flow
title: "4. Conditionals"
prerequisites: [prog.operators_expressions]
cross_module_prerequisites: []
difficulty: 2
java_version: 21
version: 1
status: draft
---

# 4. Conditionals

<!-- section: objectives -->
## Learning Objectives

After this concept you should be able to:

1. Control which statements run using `if`, `if-else` and `else if` chains.
2. Order the conditions in an `else if` chain correctly.
3. Write nested conditionals and match each `else` to its `if`.
4. Use `switch` statements and switch expressions, and explain fall-through.
5. Use the conditional (ternary) operator for simple choices between two values.

<!-- section: prerequisites -->
## Before You Start

From **Operators and Expressions** you need relational operators (`<`, `>=`, `==`), logical operators (`&&`, `||`, `!`), and the fact that Strings are compared with `equals`, not `==`.

<!-- section: theory -->
## Theory

### Why Programs Need Decisions

So far every statement in `main` has run, one after another, from top to bottom. Real programs must choose: a mark of 80 should print a distinction, a mark of 30 should not. A **conditional** runs a block of statements only when a boolean condition is `true`. This is the first form of **control flow**, which is the order in which statements actually execute.

<!-- section: theory -->
### The if Statement

```java
if (condition) {
    // runs only when condition is true
}
```

The condition must be a `boolean` expression. In Java, `if (x = 5)` does not compile, because `x = 5` is an `int`, not a `boolean`. This protects you from a common mistake in other languages.

<!-- section: theory -->
### if-else

```java
if (mark >= 40) {
    System.out.println("Pass");
} else {
    System.out.println("Fail");
}
```

Exactly one of the two blocks runs, never both and never neither.

<!-- section: theory -->
### else if Chains

When there are more than two outcomes, chain conditions with `else if`:

```java
if (mark >= 75) {
    grade = 'A';
} else if (mark >= 65) {
    grade = 'B';
} else if (mark >= 55) {
    grade = 'C';
} else {
    grade = 'F';
}
```

Java tests the conditions **from top to bottom** and runs the block of the **first** condition that is `true`. It then skips the rest of the chain. The final `else` catches every case that no condition matched.

Because the first true condition wins, **order matters**. If `mark >= 55` were tested first, a mark of 90 would receive a C, since 90 is also at least 55. With thresholds like these, test the strictest condition first.

<!-- section: theory -->
### Separate ifs Versus else if

Two separate `if` statements are independent: both may run. An `else if` runs only when all conditions above it were false.

```java
if (n > 0) { System.out.println("positive"); }
if (n > 10) { System.out.println("large"); }      // can also run

if (n > 10) { System.out.println("large"); }
else if (n > 0) { System.out.println("positive"); }   // runs only if n <= 10
```

Use a chain when the outcomes are mutually exclusive, and separate `if` statements when each check stands alone.

<!-- section: theory -->
### Nested Conditionals and Braces

A conditional can contain another conditional. Without braces, an `if` or `else` controls only the **single next statement**, and an `else` always belongs to the **nearest unmatched `if`**. Indentation does not change this, which makes code without braces easy to misread. Always use braces, even for one-line blocks.

<!-- section: theory -->
### The switch Statement

A `switch` chooses a branch by comparing one value against constant cases. It works with `int`, `char`, `String` and a few other types.

```java
switch (day) {
    case 1:
        System.out.println("Monday");
        break;
    case 2:
        System.out.println("Tuesday");
        break;
    default:
        System.out.println("Other day");
}
```

`break` ends the switch. Without it, execution **falls through** into the next case and keeps running statements until it meets a `break` or the end of the switch. Fall-through is occasionally useful for grouping cases, but usually a missing `break` is a bug. `default` runs when no case matches.

<!-- section: theory -->
### Switch Expressions

Since Java 14, a switch can also produce a value, using arrows. Arrow cases never fall through, so no `break` is needed, and several values can share one case:

```java
int days = switch (month) {
    case 2 -> 28;
    case 4, 6, 9, 11 -> 30;
    default -> 31;
};
```

Prefer this form when a switch simply chooses a value.

<!-- section: theory -->
### The Conditional (Ternary) Operator

`condition ? valueIfTrue : valueIfFalse` evaluates to one of two values:

```java
String result = mark >= 40 ? "Pass" : "Fail";
int larger = a > b ? a : b;
```

Use it for simple two-way choices of a value. For anything longer, an `if-else` is clearer.

<!-- section: theory -->
### Using boolean Variables in Conditions

A `boolean` variable is already a condition. Write `if (passed)` rather than `if (passed == true)`, and `if (!passed)` rather than `if (passed == false)`.

<!-- section: example -->
## Worked Examples

### Example 1: Grade Classification

```java
public class Main {
    public static void main(String[] args) {
        int mark = 70;
        char grade;
        if (mark >= 75) {
            grade = 'A';
        } else if (mark >= 65) {
            grade = 'B';
        } else if (mark >= 55) {
            grade = 'C';
        } else if (mark >= 40) {
            grade = 'S';
        } else {
            grade = 'F';
        }
        System.out.println(mark + " -> " + grade);
    }
}
```

```output
70 -> B
```

**Trace:** `70 >= 75` is false, so Java moves to the next condition. `70 >= 65` is true, so `grade` becomes `'B'` and the remaining conditions are never tested. Change `mark` to 88, 58, 42 and 12 and the same chain produces A, C, S and F.

<!-- section: example -->
### Example 2: Leap Years

A year is a leap year if it is divisible by 4 and not by 100, or if it is divisible by 400.

```java
public class Main {
    public static void main(String[] args) {
        int year = 1900;
        boolean leap = (year % 4 == 0 && year % 100 != 0) || year % 400 == 0;
        if (leap) {
            System.out.println(year + " is a leap year");
        } else {
            System.out.println(year + " is not a leap year");
        }
    }
}
```

```output
1900 is not a leap year
```

**Trace:** `1900 % 4 == 0` is true, but `1900 % 100 != 0` is false, so the left part of `||` is false. `1900 % 400 == 0` is also false, so `leap` is false. With the same code, 2024 and 2000 are leap years, while 2023 is not.

<!-- section: example -->
### Example 3: switch, Fall-Through and the Ternary Operator

```java
public class Main {
    public static void main(String[] args) {
        int level = 2;
        switch (level) {
            case 1:
                System.out.println("Bronze");
            case 2:
                System.out.println("Silver");
            case 3:
                System.out.println("Gold");
                break;
            default:
                System.out.println("None");
        }

        int month = 9;
        int days = switch (month) {
            case 2 -> 28;
            case 4, 6, 9, 11 -> 30;
            default -> 31;
        };
        System.out.println("Days: " + days);

        int a = 12, b = 19;
        System.out.println("Larger: " + (a > b ? a : b));
    }
}
```

```output
Silver
Gold
Days: 30
Larger: 19
```

With `level` equal to 2, the switch jumps to `case 2` and prints `Silver`. There is no `break`, so it falls through and prints `Gold`, then stops at the `break`. The arrow switch has no fall-through, so `month` 9 gives exactly 30.

<!-- section: misconception -->
## Common Misconceptions

**"All matching branches of an else-if chain run."**
Only the first true condition's block runs. The rest of the chain is skipped.

**"The order of conditions in a chain does not matter."**
With overlapping conditions such as thresholds, testing a weaker condition first captures cases meant for later branches.

**"An `else` belongs to the `if` it is indented under."**
An `else` belongs to the nearest unmatched `if`, regardless of indentation. Braces remove the ambiguity.

**"A semicolon after the condition is harmless."**
`if (x > 0);` ends the `if` with an empty statement. The block that follows then runs every time.

**"Each switch case stops by itself."**
In a classic switch, execution falls through into the next case until a `break`. Arrow cases do not fall through.

**"`if (name == "Amal")` checks whether the name is Amal."**
Strings must be compared with `name.equals("Amal")`.

**"`if (x = 5)` compares `x` with 5."**
In Java this does not compile, because the condition must be `boolean`. Use `==` to compare.

<!-- section: facts -->
## Key Facts

- The condition of an `if` must be a `boolean` expression.
- In an `if-else`, exactly one of the two blocks runs.
- In an `else if` chain, conditions are tested from top to bottom and only the first true condition's block runs.
- A final `else` runs when none of the conditions in the chain is true.
- Separate `if` statements are independent and several of them can run.
- Without braces, an `if` controls only the single next statement.
- An `else` belongs to the nearest unmatched `if`.
- A classic `switch` falls through to the next case unless a `break` ends the case.
- The `default` case of a switch runs when no case matches.
- Arrow cases (`case X ->`) do not fall through.
- A switch expression produces a value and can list several values in one case, such as `case 4, 6, 9, 11`.
- `condition ? a : b` evaluates to `a` when the condition is true and `b` otherwise.
- A year is a leap year if it is divisible by 4 and not by 100, or divisible by 400.

<!-- section: exercise -->
## Practice Questions

### Level 1: Recall (MCQ)

**Q1.** In an `else if` chain, how many blocks can run for a single input?
A. All blocks whose condition is true  B. At most one  C. Exactly two  D. None

**Q2.** What happens in a classic `switch` when a case has no `break`?
A. A compile-time error  B. The switch ends anyway  C. Execution falls through into the next case  D. The `default` case runs

**Q3.** What is the value of `x > 5 ? "big" : "small"` when `x` is 5?
A. `"big"`  B. `"small"`  C. `true`  D. It does not compile

**Q4.** Which condition correctly checks that `name` holds `"Kamal"`?
A. `name == "Kamal"`  B. `name = "Kamal"`  C. `name.equals("Kamal")`  D. `"Kamal" == name`

### Level 2: Trace and Predict

**Q5.** What does this program print?

```java
public class Main {
    public static void main(String[] args) {
        int t = 31;
        if (t > 35) {
            System.out.println("Very hot");
        } else if (t > 30) {
            System.out.println("Hot");
        } else if (t > 20) {
            System.out.println("Warm");
        }
        if (t % 2 == 1) {
            System.out.println("Odd");
        }
        if (t > 20) {
            System.out.println("Not cold");
        } else {
            System.out.println("Cold");
        }
    }
}
```

**Q6.** What does this program print?

```java
public class Main {
    public static void main(String[] args) {
        char c = 'B';
        switch (c) {
            case 'A':
                System.out.println("Apple");
                break;
            case 'B':
                System.out.println("Banana");
            case 'C':
                System.out.println("Cherry");
            default:
                System.out.println("Fruit");
        }
    }
}
```

### Level 3: Explain

**Q7.** This code is meant to print `"Distinction"` for marks of 75 or more and `"Pass"` for marks of 40 to 74, but a mark of 90 prints `"Pass"`. Explain the bug and fix it.

```java
if (mark >= 40) {
    System.out.println("Pass");
} else if (mark >= 75) {
    System.out.println("Distinction");
}
```

**Q8.** Explain the difference between two separate `if` statements and an `if` followed by an `else if`, using an example of each.

### Level 4: Implement

**Q9. Grade Letter.** Read an integer mark from 0 to 100 and print its grade: `A` for 75 and above, `B` for 65 to 74, `C` for 55 to 64, `S` for 40 to 54, and `F` below 40. If the mark is outside 0 to 100, print `Invalid`.

Sample input:

```text
67
```

Sample output:

```text
B
```

**Q10. Largest of Three.** Read three integers and print the largest.

Sample input:

```text
14 42 7
```

Sample output:

```text
42
```

### Level 5: Challenge

**Q11. Days in a Month.** Read a month number (1 to 12) and a year. Print the number of days in that month, taking leap years into account for February. If the month is outside 1 to 12, print `Invalid month`. Use a switch for the month.

Sample input:

```text
2 2024
```

Sample output:

```text
29
```

<!-- section: solution -->
## Solutions

**Q1.** B. Only the first true condition's block runs, and none runs if no condition is true and there is no `else`.

**Q2.** C. Execution continues into the next case.

**Q3.** B. `5 > 5` is `false`.

**Q4.** C. Strings are compared with `equals`.

**Q5.**

```output
Hot
Odd
Not cold
```

In the chain, `31 > 35` is false and `31 > 30` is true, so only `Hot` prints from the chain. The next two `if` statements are independent and both run.

**Q6.**

```output
Banana
Cherry
Fruit
```

The switch jumps to `case 'B'`. There are no `break` statements after it, so execution falls through the remaining cases, including `default`.

**Q7.** Conditions in a chain are tested in order and the first true one wins. A mark of 90 satisfies `mark >= 40`, so `Pass` prints and the `mark >= 75` branch is never reached. Test the stricter condition first:

```java
if (mark >= 75) {
    System.out.println("Distinction");
} else if (mark >= 40) {
    System.out.println("Pass");
}
```

**Q8.** Separate `if` statements are each tested, so more than one can run: with `n = 15`, `if (n > 0)` and `if (n > 10)` both print. In an `if` followed by `else if`, the second condition is tested only when the first was false, so at most one block runs: with `n = 15`, `if (n > 10) ... else if (n > 0) ...` prints only the first message.

**Q9.**

```java
import java.util.Scanner;

public class Main {
    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        int mark = sc.nextInt();
        if (mark < 0 || mark > 100) {
            System.out.println("Invalid");
        } else if (mark >= 75) {
            System.out.println("A");
        } else if (mark >= 65) {
            System.out.println("B");
        } else if (mark >= 55) {
            System.out.println("C");
        } else if (mark >= 40) {
            System.out.println("S");
        } else {
            System.out.println("F");
        }
    }
}
```

```input
67
```

```output
B
```

**Q10.**

```java
import java.util.Scanner;

public class Main {
    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        int a = sc.nextInt();
        int b = sc.nextInt();
        int c = sc.nextInt();
        int largest = a;
        if (b > largest) {
            largest = b;
        }
        if (c > largest) {
            largest = c;
        }
        System.out.println(largest);
    }
}
```

```input
14 42 7
```

```output
42
```

Separate `if` statements are correct here, because each comparison must happen independently.

**Q11.**

```java
import java.util.Scanner;

public class Main {
    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        int month = sc.nextInt();
        int year = sc.nextInt();
        boolean leap = (year % 4 == 0 && year % 100 != 0) || year % 400 == 0;
        switch (month) {
            case 1, 3, 5, 7, 8, 10, 12 -> System.out.println(31);
            case 4, 6, 9, 11 -> System.out.println(30);
            case 2 -> System.out.println(leap ? 29 : 28);
            default -> System.out.println("Invalid month");
        }
    }
}
```

```input
2 2024
```

```output
29
```

<!-- section: rubric -->
## Marking Rubrics

**Q7 (Explain, 3 marks)**
- 1 mark: states that conditions are tested in order and only the first true one runs.
- 1 mark: explains that 90 satisfies `mark >= 40` first, so the distinction branch is never reached.
- 1 mark: gives a corrected chain that tests `mark >= 75` first.

**Q8 (Explain, 2 marks)**
- 1 mark: separate `if` statements are all tested and more than one can run, with a valid example.
- 1 mark: an `else if` is tested only when earlier conditions were false, so at most one block runs, with a valid example.

**Q9 to Q11 (Implement and Challenge)**
- Output matches exactly on all hidden tests, including boundary values such as 40, 75, 0, 100 and invalid input: full marks.
- Q11 must apply the complete leap year rule, including the 100 and 400 exceptions.

<!-- section: further_practice -->
## Further Practice

- HackerRank, Java: *Java If-Else* (https://www.hackerrank.com/challenges/java-if-else/problem)
- LeetCode 412: *Fizz Buzz* (https://leetcode.com/problems/fizz-buzz/) (uses a loop from the next concept)
