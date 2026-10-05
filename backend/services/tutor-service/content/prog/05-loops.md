---
concept_id: prog.loops
module: prog
sequence: 5
topic: Control Flow
title: "5. Loops"
prerequisites: [prog.conditionals]
cross_module_prerequisites: []
difficulty: 2
java_version: 21
version: 1
status: draft
---

# 5. Loops

<!-- section: objectives -->
## Learning Objectives

After this concept you should be able to:

1. Write `while`, `for` and `do-while` loops and choose the right one for a task.
2. Trace a loop iteration by iteration and state how many times its body runs.
3. Use the counting, accumulator and sentinel loop patterns.
4. Use `break` and `continue` correctly.
5. Recognise and fix infinite loops and off-by-one errors.

<!-- section: prerequisites -->
## Before You Start

From **Conditionals** you need boolean conditions and `if` statements. From **Operators and Expressions** you need compound assignment (`+=`, `++`) and the remainder operator `%`.

<!-- section: theory -->
## Theory

### Why Loops

Printing the numbers 1 to 5 with five `println` statements works. Printing 1 to 1000 that way does not. A **loop** repeats a block of statements while a condition holds. Each repetition is called an **iteration**, and the block being repeated is the **body**.

<!-- section: theory -->
### The while Loop

```java
while (condition) {
    // body
}
```

1. The condition is checked.
2. If it is `true`, the body runs once, then control goes back to step 1.
3. If it is `false`, the loop ends and execution continues after the loop.

The condition is checked **before every iteration**, including the first. If it is false at the start, the body runs **zero** times.

Every loop needs three parts: an **initialisation** before the loop, a **condition**, and an **update** inside the body that eventually makes the condition false.

```java
int i = 1;             // initialisation
while (i <= 5) {       // condition
    System.out.println(i);
    i++;               // update
}
```

<!-- section: theory -->
### Infinite Loops

If the update is missing, or never makes the condition false, the loop never ends. This is an **infinite loop**. Removing `i++` from the example above prints `1` forever. When a program seems to hang, check each loop's update first.

<!-- section: theory -->
### The for Loop

A `for` loop places all three parts in one line:

```java
for (int i = 1; i <= 5; i++) {
    System.out.println(i);
}
```

It is equivalent to the `while` loop above. The initialisation runs once, the condition is checked before each iteration, and the update runs **after** each iteration of the body.

A variable declared in the initialisation, such as `i`, exists only inside the loop. Using `i` after the loop ends is a compile-time error.

Use a `for` loop when the number of iterations is known in advance, for example "repeat `n` times" or "count from 1 to 100".

<!-- section: theory -->
### The do-while Loop

```java
do {
    // body
} while (condition);
```

The body runs **first** and the condition is checked afterwards, so the body always runs **at least once**. This suits tasks such as reading input until it is valid, where you must read at least once before you can check it. Note the semicolon after the condition.

<!-- section: theory -->
### Counting Iterations and Off-by-One Errors

`for (int i = 0; i < n; i++)` runs exactly `n` times, with `i` taking values `0` to `n - 1`.
`for (int i = 1; i <= n; i++)` also runs `n` times, with `i` taking values `1` to `n`.
`for (int i = 0; i <= n; i++)` runs `n + 1` times.

Using `<=` where `<` was intended, or starting at the wrong value, gives one iteration too many or too few. This is an **off-by-one error**, one of the most common bugs in programming. When writing a loop, check the first and last values of the loop variable explicitly.

<!-- section: theory -->
### Loop Patterns

Most loops follow one of a few patterns.

**Counting:** repeat a fixed number of times.

**Accumulator:** build up a result across iterations. Start the accumulator at the identity value: `0` for a sum, `1` for a product.

```java
int sum = 0;
for (int i = 1; i <= n; i++) {
    sum += i;
}
```

**Counter:** count how many iterations satisfy a condition.

```java
int evens = 0;
for (int i = 1; i <= n; i++) {
    if (i % 2 == 0) {
        evens++;
    }
}
```

**Sentinel:** keep reading input until a special stop value, the **sentinel**, appears. The number of iterations is not known in advance, so a `while` loop is used.

**Digit processing:** repeatedly take `n % 10` and do `n = n / 10` until `n` is `0`.

<!-- section: theory -->
### break and continue

- `break` ends the loop immediately. Execution continues after the loop.
- `continue` skips the rest of the current iteration. In a `for` loop the update still runs, then the condition is checked again.

Use them sparingly: a loop whose condition describes when it stops is easier to understand than one with several exits.

<!-- section: theory -->
### Choosing a Loop

| Situation | Loop |
|---|---|
| Number of iterations known in advance | `for` |
| Repeat until something happens, possibly zero times | `while` |
| Must run at least once, then check | `do-while` |

<!-- section: example -->
## Worked Examples

### Example 1: Sum of 1 to n, with a Trace

```java
public class Main {
    public static void main(String[] args) {
        int n = 4;
        int sum = 0;
        for (int i = 1; i <= n; i++) {
            sum += i;
        }
        System.out.println("Sum = " + sum);
    }
}
```

```output
Sum = 10
```

**Trace:**

| Iteration | i before body | Condition `i <= 4` | sum after body |
|---|---|---|---|
| 1 | 1 | true | 1 |
| 2 | 2 | true | 3 |
| 3 | 3 | true | 6 |
| 4 | 4 | true | 10 |
| (end) | 5 | false | 10 |

The body runs 4 times. The condition is checked 5 times: the fifth check is the one that ends the loop.

<!-- section: example -->
### Example 2: Sentinel Loop

Read whole numbers until `0` appears, then print how many numbers were read and their total. The `0` is the sentinel and is not counted.

```java
import java.util.Scanner;

public class Main {
    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        int count = 0;
        int total = 0;
        int x = sc.nextInt();
        while (x != 0) {
            count++;
            total += x;
            x = sc.nextInt();
        }
        System.out.println("Count: " + count);
        System.out.println("Total: " + total);
    }
}
```

```input
12 7 30 0
```

```output
Count: 3
Total: 49
```

The first value is read **before** the loop so that the condition has something to test, and the next value is read at the **end** of the body. This "read, then loop while not sentinel" shape is the standard sentinel pattern.

<!-- section: example -->
### Example 3: Reversing Digits

```java
public class Main {
    public static void main(String[] args) {
        int n = 1204;
        int reversed = 0;
        while (n > 0) {
            int digit = n % 10;
            reversed = reversed * 10 + digit;
            n = n / 10;
        }
        System.out.println(reversed);
    }
}
```

```output
4021
```

**Trace:**

| n at start | digit | reversed after | n after |
|---|---|---|---|
| 1204 | 4 | 4 | 120 |
| 120 | 0 | 40 | 12 |
| 12 | 2 | 402 | 1 |
| 1 | 1 | 4021 | 0 |

<!-- section: example -->
### Example 4: break, continue and do-while

```java
public class Main {
    public static void main(String[] args) {
        for (int i = 1; i <= 10; i++) {
            if (i % 3 == 0) {
                continue;
            }
            if (i > 7) {
                break;
            }
            System.out.print(i + " ");
        }
        System.out.println();

        int k = 100;
        do {
            System.out.println("Runs once, k = " + k);
        } while (k < 10);
    }
}
```

```output
1 2 4 5 7 
Runs once, k = 100
```

Multiples of 3 are skipped by `continue`. When `i` reaches 8, `break` ends the loop. The `do-while` body runs once even though `k < 10` is false from the start.

<!-- section: misconception -->
## Common Misconceptions

**"The loop condition is checked after every statement in the body."**
It is checked once per iteration: before each iteration for `while` and `for`, after each iteration for `do-while`. If the condition becomes false in the middle of the body, the rest of the body still runs.

**"`for (int i = 0; i <= n; i++)` runs `n` times."**
It runs `n + 1` times. `i < n` from 0, or `i <= n` from 1, gives `n` iterations.

**"A `while` loop always runs at least once."**
A `while` loop can run zero times. Only `do-while` guarantees one iteration.

**"A semicolon after `for (...)` is harmless."**
`for (int i = 0; i < 5; i++);` has an empty body. The block after it runs once, after the loop has finished.

**"The loop variable is still available after a for loop."**
A variable declared in the `for` header exists only inside the loop.

**"`continue` ends the loop."**
`continue` ends only the current iteration. `break` ends the loop.

**"An accumulator for a product can start at 0."**
Anything multiplied by 0 is 0. A product accumulator starts at 1.

<!-- section: facts -->
## Key Facts

- A loop repeats its body while its condition is `true`; each repetition is an iteration.
- A `while` loop checks its condition before each iteration and can run zero times.
- A `for` loop has an initialisation, a condition and an update in its header.
- In a `for` loop the update runs after each iteration of the body.
- A variable declared in a `for` header is only accessible inside the loop.
- A `do-while` loop checks its condition after each iteration and always runs at least once.
- A loop whose condition never becomes false is an infinite loop.
- `for (int i = 0; i < n; i++)` runs exactly `n` times.
- An off-by-one error makes a loop run one time too many or too few.
- A sum accumulator starts at 0 and a product accumulator starts at 1.
- A sentinel loop reads input until a special stop value appears.
- `break` ends a loop immediately; `continue` skips to the next iteration.
- `n % 10` extracts the last digit and `n / 10` removes it; repeating both processes every digit.

<!-- section: exercise -->
## Practice Questions

### Level 1: Recall (MCQ)

**Q1.** How many times does the body of `for (int i = 2; i < 10; i += 2)` run?
A. 3  B. 4  C. 5  D. 8

**Q2.** Which loop always executes its body at least once?
A. `for`  B. `while`  C. `do-while`  D. All of them

**Q3.** What does `continue` do inside a loop?
A. Ends the loop  B. Skips the rest of the current iteration  C. Restarts the loop from the first iteration  D. Exits the program

**Q4.** What is the correct starting value of an accumulator that computes a product?
A. 0  B. 1  C. -1  D. It does not matter

### Level 2: Trace and Predict

**Q5.** What does this program print?

```java
public class Main {
    public static void main(String[] args) {
        int x = 1;
        int steps = 0;
        while (x < 50) {
            x = x * 3;
            steps++;
        }
        System.out.println(x + " " + steps);
    }
}
```

**Q6.** What does this program print?

```java
public class Main {
    public static void main(String[] args) {
        int total = 0;
        for (int i = 10; i >= 1; i--) {
            if (i % 4 == 0) {
                continue;
            }
            if (total > 20) {
                break;
            }
            total += i;
        }
        System.out.println(total);
    }
}
```

### Level 3: Explain

**Q7.** A student wants to print the numbers 1 to 10 and writes `for (int i = 1; i < 10; i++)`. Explain what is printed, name this kind of bug, and give two different correct loop headers.

**Q8.** Explain when a `do-while` loop is a better choice than a `while` loop, with an example.

### Level 4: Implement

**Q9. Even Sum.** Read a positive integer `n` and print the sum of all even numbers from 1 to `n`.

Sample input:

```text
10
```

Sample output:

```text
30
```

**Q10. Factorial.** Read an integer `n` from 0 to 20 and print `n!`. Note that `0!` is 1. Use `long`, because `20!` does not fit in an `int`.

Sample input:

```text
15
```

Sample output:

```text
1307674368000
```

### Level 5: Challenge

**Q11. Collatz Steps.** Start from a positive integer `n`. If `n` is even, replace it with `n / 2`; if it is odd, replace it with `3n + 1`. Repeat until `n` becomes 1. Read `n`, and print the number of steps taken to reach 1 and the largest value reached along the way (including the starting value), on two lines.

Sample input:

```text
6
```

Sample output:

```text
Steps: 8
Max: 16
```

(The sequence is 6, 3, 10, 5, 16, 8, 4, 2, 1.)

<!-- section: solution -->
## Solutions

**Q1.** B. `i` takes the values 2, 4, 6, 8.

**Q2.** C.

**Q3.** B.

**Q4.** B. Starting at 0 would make every product 0.

**Q5.**

```output
81 4
```

`x` goes 1, 3, 9, 27, 81. After four multiplications `x` is 81, which is not less than 50, so the loop stops.

**Q6.**

```output
26
```

| i | Action | total |
|---|---|---|
| 10 | not a multiple of 4; 0 is not > 20, so add | 10 |
| 9 | 10 is not > 20, so add | 19 |
| 8 | multiple of 4, `continue` skips it | 19 |
| 7 | 19 is not > 20, so add | 26 |
| 6 | 26 > 20, `break` | 26 |

The `break` check happens before the addition, so the total can pass 20 once before the loop stops.

**Q7.** The condition `i < 10` stops before 10, so only 1 to 9 are printed. This is an off-by-one error. Correct headers include `for (int i = 1; i <= 10; i++)` and `for (int i = 0; i < 10; i++)` with `i + 1` printed.

**Q8.** A `do-while` is better when the body must run once before the condition can be tested. For example, when asking for a mark between 0 and 100, the program must read a value before it can check it, and should keep asking while the value is invalid: `do { mark = sc.nextInt(); } while (mark < 0 || mark > 100);`

**Q9.**

```java
import java.util.Scanner;

public class Main {
    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        int n = sc.nextInt();
        int sum = 0;
        for (int i = 2; i <= n; i += 2) {
            sum += i;
        }
        System.out.println(sum);
    }
}
```

```input
10
```

```output
30
```

**Q10.**

```java
import java.util.Scanner;

public class Main {
    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        int n = sc.nextInt();
        long result = 1;
        for (int i = 2; i <= n; i++) {
            result *= i;
        }
        System.out.println(result);
    }
}
```

```input
15
```

```output
1307674368000
```

For `n` equal to 0 or 1 the loop body never runs and the result stays 1, which is correct.

**Q11.**

```java
import java.util.Scanner;

public class Main {
    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        long n = sc.nextLong();
        int steps = 0;
        long max = n;
        while (n != 1) {
            if (n % 2 == 0) {
                n = n / 2;
            } else {
                n = 3 * n + 1;
            }
            steps++;
            if (n > max) {
                max = n;
            }
        }
        System.out.println("Steps: " + steps);
        System.out.println("Max: " + max);
    }
}
```

```input
6
```

```output
Steps: 8
Max: 16
```

`long` is used because intermediate values in the sequence can grow much larger than the starting number.

<!-- section: rubric -->
## Marking Rubrics

**Q7 (Explain, 3 marks)**
- 1 mark: states that 1 to 9 are printed and 10 is missing.
- 1 mark: names the bug as an off-by-one error.
- 1 mark: gives two correct alternatives.

**Q8 (Explain, 2 marks)**
- 1 mark: states that a `do-while` runs its body at least once because the condition is checked afterwards.
- 1 mark: gives a valid example where the body must run before the condition can be evaluated, such as input validation.

**Q9 to Q11 (Implement and Challenge)**
- Output matches exactly on all hidden tests, including edge cases such as `n = 1` for Q9, `n = 0` for Q10 and `n = 1` for Q11: full marks.
- Q10 must use `long`; an `int` solution fails for `n` above 12.
- Q11 must count steps, not sequence values, and must include the starting value when finding the maximum.

<!-- section: further_practice -->
## Further Practice

- HackerRank, Java: *Java Loops I* (https://www.hackerrank.com/challenges/java-loops-i/problem)
- HackerRank, Java: *Java Loops II* (https://www.hackerrank.com/challenges/java-loops/problem)
- LeetCode 412: *Fizz Buzz* (https://leetcode.com/problems/fizz-buzz/)
- LeetCode 1342: *Number of Steps to Reduce a Number to Zero* (https://leetcode.com/problems/number-of-steps-to-reduce-a-number-to-zero/)
- LeetCode 9: *Palindrome Number* (https://leetcode.com/problems/palindrome-number/)
