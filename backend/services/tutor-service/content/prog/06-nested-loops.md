---
concept_id: prog.nested_loops
module: prog
sequence: 6
topic: Control Flow
title: "6. Nested Loops"
prerequisites: [prog.loops]
cross_module_prerequisites: []
difficulty: 2
java_version: 21
version: 1
status: draft
---

# 6. Nested Loops

<!-- section: objectives -->
## Learning Objectives

After this concept you should be able to:

1. Explain how an inner loop runs completely for each iteration of an outer loop.
2. Calculate the total number of inner iterations, including when the inner bound depends on the outer variable.
3. Use nested loops to produce tables, patterns and pairs.
4. Explain why nested loops grow much faster than single loops as input size increases.
5. Predict the effect of `break` inside a nested loop.

<!-- section: prerequisites -->
## Before You Start

From **Loops** you need to write and trace `for` and `while` loops, count how many times a loop body runs, and use `break`.

<!-- section: theory -->
## Theory

### A Loop Inside a Loop

A **nested loop** is a loop whose body contains another loop. The outer loop controls rows, rounds or first choices; the inner loop does the work for each of them.

```java
for (int i = 1; i <= 3; i++) {          // outer loop
    for (int j = 1; j <= 4; j++) {      // inner loop
        System.out.print("*");
    }
    System.out.println();
}
```

The key rule: **for every single iteration of the outer loop, the inner loop runs from its start to its end.** Here, when `i` is 1, `j` goes 1, 2, 3, 4. Then `i` becomes 2, and `j` starts again from 1. The output is 3 rows of 4 stars.

By convention the outer variable is `i` and the inner one is `j`. They must be different variables: reusing `i` in the inner loop would overwrite the outer counter.

<!-- section: theory -->
### Counting Total Iterations

When the inner loop runs a fixed number of times, the total is a **product**:

> total inner iterations = (outer iterations) × (inner iterations per outer iteration)

The example above prints 3 × 4 = 12 stars.

When the inner bound **depends on the outer variable**, add up the inner counts instead. In

```java
for (int i = 1; i <= n; i++) {
    for (int j = 1; j <= i; j++) {
        // body
    }
}
```

the inner loop runs 1 time, then 2, then 3, up to `n`. The total is 1 + 2 + ... + n = n(n + 1) / 2. For `n = 10` that is 55.

For all **pairs** of distinct values where order does not matter, the inner loop starts one past the outer variable:

```java
for (int i = 1; i <= n; i++) {
    for (int j = i + 1; j <= n; j++) {
        // each unordered pair (i, j) exactly once
    }
}
```

This runs n(n - 1) / 2 times. For `n = 5` that is 10 pairs.

<!-- section: theory -->
### Why Nested Loops Get Slow

A single loop over `n` items does about `n` units of work. A loop nested inside another, both over `n`, does about `n × n = n²`. The difference grows quickly:

| n | Single loop, n | Nested loops, n² |
|---|---|---|
| 10 | 10 | 100 |
| 100 | 100 | 10,000 |
| 1,000 | 1,000 | 1,000,000 |
| 10,000 | 10,000 | 100,000,000 |

Doubling `n` doubles the work of a single loop but **quadruples** the work of a nested loop. Measuring how work grows with input size is the subject of Big-O analysis in the Data Structures and Algorithms module.

<!-- section: theory -->
### Common Nested Loop Patterns

| Pattern | Outer loop | Inner loop |
|---|---|---|
| Grid or table | Rows | Columns in each row |
| Triangle shape | Rows | Columns up to the row number |
| Pairs | First item | Second item, starting after the first |
| Search with a check | Candidate values | Tests on each candidate |

The last pattern is common for problems like finding primes: the outer loop chooses a candidate number, and the inner loop tests possible divisors.

<!-- section: theory -->
### break in Nested Loops

`break` ends only the **innermost** loop that contains it. The outer loop continues with its next iteration. To stop both loops, a common approach is a `boolean` flag checked by the outer loop condition. Java also offers labelled breaks (`break outer;`), but a flag is usually clearer.

<!-- section: theory -->
### Resetting Inner while Loops

A `for` loop resets its own variable every time it starts. An inner `while` loop does not: its counter must be reset explicitly **inside the outer loop**. If the counter is initialised once, before the outer loop, the inner loop runs fully only during the first outer iteration and not at all afterwards.

<!-- section: example -->
## Worked Examples

### Example 1: Multiplication Table

```java
public class Main {
    public static void main(String[] args) {
        int n = 4;
        for (int i = 1; i <= n; i++) {
            for (int j = 1; j <= n; j++) {
                System.out.print(i * j + "\t");
            }
            System.out.println();
        }
    }
}
```

```output
1	2	3	4	
2	4	6	8	
3	6	9	12	
4	8	12	16	
```

Each row is one outer iteration. Within a row, `j` runs from 1 to 4. `println()` after the inner loop ends the row. The body of the inner loop runs 4 × 4 = 16 times.

<!-- section: example -->
### Example 2: Triangle Pattern

```java
public class Main {
    public static void main(String[] args) {
        int rows = 4;
        int stars = 0;
        for (int i = 1; i <= rows; i++) {
            for (int j = 1; j <= i; j++) {
                System.out.print("*");
                stars++;
            }
            System.out.println();
        }
        System.out.println("Stars: " + stars);
    }
}
```

```output
*
**
***
****
Stars: 10
```

**Trace of the inner loop's range:**

| i | j runs | stars printed this row | total stars |
|---|---|---|---|
| 1 | 1 | 1 | 1 |
| 2 | 1 to 2 | 2 | 3 |
| 3 | 1 to 3 | 3 | 6 |
| 4 | 1 to 4 | 4 | 10 |

The total, 10, matches 4 × 5 / 2.

<!-- section: example -->
### Example 3: Pairs with a Target Sum

Count the pairs of distinct numbers from 1 to 6 whose sum is 7.

```java
public class Main {
    public static void main(String[] args) {
        int n = 6;
        int target = 7;
        int pairs = 0;
        for (int i = 1; i <= n; i++) {
            for (int j = i + 1; j <= n; j++) {
                if (i + j == target) {
                    System.out.println(i + " + " + j);
                    pairs++;
                }
            }
        }
        System.out.println("Pairs: " + pairs);
    }
}
```

```output
1 + 6
2 + 5
3 + 4
Pairs: 3
```

Starting `j` at `i + 1` means each pair is checked once and a number is never paired with itself. If `j` started at 1, the program would also print `4 + 3`, `5 + 2` and `6 + 1`.

<!-- section: example -->
### Example 4: break Leaves Only the Inner Loop

```java
public class Main {
    public static void main(String[] args) {
        for (int i = 1; i <= 3; i++) {
            for (int j = 1; j <= 3; j++) {
                if (j == 2) {
                    break;
                }
                System.out.println("i=" + i + " j=" + j);
            }
        }
    }
}
```

```output
i=1 j=1
i=2 j=1
i=3 j=1
```

The `break` ends the inner loop when `j` reaches 2, but the outer loop carries on, so every value of `i` still appears.

<!-- section: misconception -->
## Common Misconceptions

**"The inner loop runs once in total."**
The inner loop runs from start to finish once for **every** iteration of the outer loop.

**"Total iterations are outer plus inner."**
They are outer **times** inner when the inner count is fixed. 10 rows of 10 columns is 100 iterations, not 20.

**"`break` in the inner loop stops both loops."**
`break` exits only the innermost loop containing it.

**"The inner and outer loops can share the same variable."**
Using `i` for both makes the inner loop change the outer counter, which usually causes infinite loops or skipped rows.

**"An inner while loop resets itself like a for loop."**
A `while` loop's counter must be reset inside the outer loop. Otherwise the inner loop only runs during the first outer iteration.

**"Doubling the input doubles the running time of any loop."**
For nested loops over the same input, doubling the input roughly quadruples the work.

<!-- section: facts -->
## Key Facts

- In a nested loop, the inner loop runs completely for each iteration of the outer loop.
- With a fixed inner count, total inner iterations equal outer iterations multiplied by inner iterations.
- When the inner loop runs `i` times for `i` from 1 to `n`, the total is n(n + 1) / 2.
- Looping `j` from `i + 1` checks each unordered pair once; there are n(n - 1) / 2 such pairs.
- Two nested loops over `n` items perform about n² iterations.
- Doubling `n` roughly quadruples the work of two nested loops.
- The inner and outer loops must use different loop variables.
- `break` exits only the innermost enclosing loop.
- An inner `while` loop's counter must be reset inside the outer loop.
- Printing `println()` after the inner loop is the usual way to end each row of a grid or pattern.

<!-- section: exercise -->
## Practice Questions

### Level 1: Recall (MCQ)

**Q1.** An outer loop runs 5 times and its inner loop runs 8 times per outer iteration. How many times does the inner body run in total?
A. 13  B. 40  C. 8  D. 5

**Q2.** Where must the counter of an inner `while` loop be reset?
A. Before the outer loop  B. Inside the outer loop, before the inner loop  C. After the inner loop  D. It never needs resetting

**Q3.** `break` is executed inside an inner loop. What happens next?
A. Both loops end  B. The program ends  C. The inner loop ends and the outer loop continues  D. The inner loop restarts

**Q4.** Two nested loops each run over `n` items. Roughly how much more work is done when `n` changes from 100 to 200?
A. The same  B. Twice as much  C. Four times as much  D. Eight times as much

### Level 2: Trace and Predict

**Q5.** What does this program print?

```java
public class Main {
    public static void main(String[] args) {
        int count = 0;
        for (int i = 0; i < 4; i++) {
            for (int j = i; j < 4; j++) {
                count++;
            }
        }
        System.out.println(count);
    }
}
```

**Q6.** What does this program print?

```java
public class Main {
    public static void main(String[] args) {
        for (int i = 1; i <= 3; i++) {
            for (int j = 3; j >= i; j--) {
                System.out.print(j);
            }
            System.out.println();
        }
    }
}
```

### Level 3: Explain

**Q7.** A program checks every pair of students in a class to find two with the same birthday. With 100 students it takes 1 second. Explain roughly how long it would take with 1,000 students and why.

**Q8.** Explain the bug in this code, which is meant to print a 3 by 3 grid of `#`, and fix it.

```java
int j = 0;
for (int i = 0; i < 3; i++) {
    while (j < 3) {
        System.out.print("#");
        j++;
    }
    System.out.println();
}
```

### Level 4: Implement

**Q9. Number Triangle.** Read a positive integer `n` and print `n` rows. Row `r` contains the numbers 1 to `r` separated by single spaces.

Sample input:

```text
4
```

Sample output:

```text
1
1 2
1 2 3
1 2 3 4
```

**Q10. Divisible Pairs.** Read two positive integers `n` and `k`. Count the pairs `(a, b)` with `1 <= a < b <= n` where `a + b` is divisible by `k`, and print the count.

Sample input:

```text
6 3
```

Sample output:

```text
5
```

### Level 5: Challenge

**Q11. Primes up to n.** Read an integer `n` (at least 2) and print every prime number from 2 to `n` on one line, separated by single spaces. A prime has exactly two divisors: 1 and itself. Use a nested loop: the outer loop chooses the candidate, and the inner loop tests divisors. Stop testing a candidate as soon as a divisor is found.

Sample input:

```text
30
```

Sample output:

```text
2 3 5 7 11 13 17 19 23 29
```

<!-- section: solution -->
## Solutions

**Q1.** B. 5 × 8 = 40.

**Q2.** B. Otherwise the inner loop only runs during the first outer iteration.

**Q3.** C.

**Q4.** C. The work grows with n², and 200² / 100² = 4.

**Q5.**

```output
10
```

The inner loop runs 4, 3, 2 and 1 times as `i` goes from 0 to 3, giving 4 + 3 + 2 + 1 = 10.

**Q6.**

```output
321
32
3
```

The inner loop counts down from 3 to `i`, so each row is one number shorter.

**Q7.** Checking every pair uses nested loops, so the number of comparisons grows with the square of the class size (about n(n - 1) / 2 pairs). Going from 100 to 1,000 students multiplies n by 10, so the work multiplies by about 10² = 100. The program would take roughly 100 seconds.

**Q8.** `j` is initialised once, before the outer loop. During the first outer iteration the inner loop runs until `j` is 3, and `j` stays 3 afterwards, so the inner loop never runs again. The output is one row of `###` followed by two empty lines. The fix is to reset `j` inside the outer loop:

```java
for (int i = 0; i < 3; i++) {
    int j = 0;
    while (j < 3) {
        System.out.print("#");
        j++;
    }
    System.out.println();
}
```

**Q9.**

```java
import java.util.Scanner;

public class Main {
    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        int n = sc.nextInt();
        for (int r = 1; r <= n; r++) {
            for (int c = 1; c <= r; c++) {
                if (c > 1) {
                    System.out.print(" ");
                }
                System.out.print(c);
            }
            System.out.println();
        }
    }
}
```

```input
4
```

```output
1
1 2
1 2 3
1 2 3 4
```

Printing the space only before numbers after the first avoids a trailing space at the end of each row.

**Q10.**

```java
import java.util.Scanner;

public class Main {
    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        int n = sc.nextInt();
        int k = sc.nextInt();
        int count = 0;
        for (int a = 1; a <= n; a++) {
            for (int b = a + 1; b <= n; b++) {
                if ((a + b) % k == 0) {
                    count++;
                }
            }
        }
        System.out.println(count);
    }
}
```

```input
6 3
```

```output
5
```

The pairs are (1, 2), (1, 5), (2, 4), (3, 6) and (4, 5).

**Q11.**

```java
import java.util.Scanner;

public class Main {
    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        int n = sc.nextInt();
        boolean first = true;
        for (int candidate = 2; candidate <= n; candidate++) {
            boolean prime = true;
            for (int d = 2; d * d <= candidate; d++) {
                if (candidate % d == 0) {
                    prime = false;
                    break;
                }
            }
            if (prime) {
                if (!first) {
                    System.out.print(" ");
                }
                System.out.print(candidate);
                first = false;
            }
        }
        System.out.println();
    }
}
```

```input
30
```

```output
2 3 5 7 11 13 17 19 23 29
```

Testing divisors only while `d * d <= candidate` is enough: if a number has a divisor larger than its square root, it must also have one smaller than it. The `break` stops testing a candidate as soon as it is known not to be prime.

<!-- section: rubric -->
## Marking Rubrics

**Q7 (Explain, 3 marks)**
- 1 mark: identifies that checking every pair requires nested loops, so work grows with the square of the input size.
- 1 mark: calculates that a tenfold increase in students gives about a hundredfold increase in work.
- 1 mark: concludes about 100 seconds.

**Q8 (Explain, 3 marks)**
- 1 mark: identifies that `j` is not reset for each outer iteration.
- 1 mark: describes the actual output (one row, then empty lines).
- 1 mark: gives the fix of initialising `j` inside the outer loop.

**Q9 to Q11 (Implement and Challenge)**
- Output matches exactly on all hidden tests, with no trailing spaces: full marks.
- Q10 must count each unordered pair once.
- Q11 must use a nested loop that stops testing a candidate once a divisor is found. Solutions that hard-code primes receive no marks.

<!-- section: further_practice -->
## Further Practice

- LeetCode 1672: *Richest Customer Wealth* (https://leetcode.com/problems/richest-customer-wealth/) (uses arrays from concept 9)
- LeetCode 118: *Pascal's Triangle* (https://leetcode.com/problems/pascals-triangle/)
- LeetCode 204: *Count Primes* (https://leetcode.com/problems/count-primes/)
