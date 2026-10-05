---
concept_id: prog.code_tracing
module: prog
sequence: 13
topic: Program Tracing
title: "13. Tracing Program Execution"
prerequisites: [prog.nested_loops, prog.call_flow, prog.references]
cross_module_prerequisites: []
difficulty: 3
java_version: 21
version: 1
status: draft
---

# 13. Tracing Program Execution

<!-- section: objectives -->
## Learning Objectives

After this concept you should be able to:

1. Trace a program by hand using a trace table, recording every change of state in order.
2. Trace programs that combine loops, conditionals, method calls, arrays and objects.
3. Choose test inputs, including boundary and edge cases, to desk-check a program.
4. Use a trace to locate and explain a logic error.
5. Use print statements and a debugger to observe a program's state while it runs.

<!-- section: prerequisites -->
## Before You Start

This concept brings together everything in the module. You need nested loops (**Nested Loops**), the rule that each method call has its own local variables and that callers pause until callees return (**Method Call Flow and Scope**), and the box-and-arrow model of objects and aliasing (**References**).

<!-- section: theory -->
## Theory

### What Tracing Is

**Tracing** means executing a program by hand, one statement at a time, exactly as the computer would, and recording how its **state** changes. A program's state is the current value of every variable, the contents of every array and object, the active method calls, and the output produced so far.

Tracing matters for two reasons:

- **Predicting behaviour.** Before running code, you can say what it will do, which is the clearest evidence that you understand it.
- **Finding logic errors.** Logic errors produce wrong results without any error message. Tracing shows the exact step where the program's state diverges from what you intended.

The golden rule is: **trace what the code says, not what you meant it to say.** Most tracing mistakes come from silently "correcting" the code in your head.

<!-- section: theory -->
### The Trace Table

A **trace table** has one column per variable (and one for output) and one row per step. Write a new row each time something changes, and write only the values that change. Reading down a column shows the history of that variable.

For a loop, a practical layout is one row per iteration, with columns for the loop variable, the condition, the values updated in the body, and any output. Always include the final condition check that ends the loop; that row confirms how many iterations ran.

<!-- section: theory -->
### Tracing Rules for Each Construct

| Construct | What to record |
|---|---|
| Assignment | Evaluate the right side fully using current values, then update the left side |
| Integer arithmetic | Apply integer division and `%` exactly; `7 / 2` is 3 |
| `if` / `else if` | Evaluate each condition in order; follow only the first true branch |
| `&&`, `\|\|` | Stop evaluating when the left operand decides the result |
| Loops | Check the condition before each iteration (`while`, `for`) or after (`do-while`); record the update |
| Nested loops | Restart the inner loop fully for every outer iteration |
| Method call | Add a frame with the parameters' copied values; the caller pauses |
| `return` | Remove the frame; resume the caller at the call, using the returned value |
| Arrays | Draw the array as a row of cells and update individual cells |
| Objects | Draw each object as a box; draw reference variables as arrows to boxes |
| Reference assignment | Move or copy the arrow; no new box is created unless `new` runs |

<!-- section: theory -->
### Tracing Method Calls

Keep a column of **active calls**, with the newest call at the bottom. Each call has its own local variables, so a variable named `n` in two different frames is two different values. When a call returns, cross out its frame and write the returned value where the call appeared in the caller's expression. This column is a hand-drawn version of the **call stack**, which you will use heavily when tracing recursion in the next module.

<!-- section: theory -->
### Tracing Arrays and Objects

Draw arrays and objects as diagrams rather than trying to hold them in your head. For each statement:

- If it creates something with `new`, draw a new box.
- If it assigns one reference to another, draw a second arrow to the **same** box. This is how you spot aliasing: two arrows, one box, so a change through either one changes that box.
- If it changes a cell or field, update the box, not the arrow.
- If a method receives an array or object, its parameter is a new arrow to the caller's box.

<!-- section: theory -->
### Choosing Inputs: Desk-Checking

**Desk-checking** is tracing a program with chosen test inputs to check it works before, or instead of, running it. A single "typical" input rarely reveals bugs. Trace with:

- **A typical case:** ordinary values in the middle of the valid range.
- **Boundary cases:** values at the edges of conditions, such as a mark of exactly 40 or 75, or a loop that should run zero or one times.
- **Edge cases:** the smallest input (an array of length 1, the number 0), negative values, duplicates, and values that are all equal.

Most off-by-one errors and wrong comparisons (`<` instead of `<=`) only show up at boundaries.

<!-- section: theory -->
### Print Debugging and Debuggers

When a program is too long to trace entirely by hand, observe it while it runs.

- **Print debugging:** add temporary `System.out.println` statements that show variable values at key points, such as `System.out.println("i=" + i + " sum=" + sum);` at the end of each loop iteration. The output is an automatic trace. Remove these statements when you are done.
- **A debugger** (built into VS Code and IntelliJ) lets you set a **breakpoint** on a line so the program pauses there. You can then **step over** a line (run it and pause at the next), **step into** a method call (pause at the first line of the called method), and inspect every variable and the call stack at each pause.

Both are tools for checking a trace, not replacements for being able to trace by hand.

<!-- section: example -->
## Worked Examples

### Example 1: A Loop with a Nested Condition

```java
public class Main {
    public static void main(String[] args) {
        int a = 0;
        int b = 1;
        for (int i = 1; i <= 5; i++) {
            if (i % 2 == 0) {
                a += i;
            } else {
                b *= i;
            }
        }
        System.out.println(a + " " + b);
    }
}
```

```output
6 15
```

**Trace table:**

| i | `i <= 5` | `i % 2 == 0` | a | b |
|---|---|---|---|---|
| start | | | 0 | 1 |
| 1 | true | false | 0 | 1 |
| 2 | true | true | 2 | 1 |
| 3 | true | false | 2 | 3 |
| 4 | true | true | 6 | 3 |
| 5 | true | false | 6 | 15 |
| 6 | false | | 6 | 15 |

<!-- section: example -->
### Example 2: Method Calls with Active Frames

```java
public class Main {
    public static void main(String[] args) {
        int x = 4;
        int y = f(x + 1) + g(x);
        System.out.println(x + " " + y);
    }

    public static int f(int n) {
        n = n * 2;
        return g(n) - 1;
    }

    public static int g(int n) {
        return n + 3;
    }
}
```

```output
4 19
```

**Trace with active calls (bottom is running):**

| Step | Active calls | Event |
|---|---|---|
| 1 | main (x=4) | Evaluate `f(x + 1)`: call `f(5)` |
| 2 | main (x=4), f (n=5) | `n` becomes 10; call `g(10)` |
| 3 | main, f (n=10), g (n=10) | `g` returns 13 |
| 4 | main, f (n=10) | `f` returns 13 - 1 = 12 |
| 5 | main (x=4) | Evaluate `g(x)`: call `g(4)` |
| 6 | main, g (n=4) | `g` returns 7 |
| 7 | main (x=4) | `y` = 12 + 7 = 19 |

Notice step 3: two variables named `n` exist at the same time, one in `f` (10) and one in `g` (10), and `main`'s `x` is never changed by either call because each receives a copy.

<!-- section: example -->
### Example 3: Arrays, Objects and Aliasing

```java
public class Main {
    public static void main(String[] args) {
        int[] p = {1, 2, 3};
        int[] q = p;
        Holder h = new Holder(p);
        q[0] = 10;
        h.data[1] = 20;
        p = new int[]{7, 8, 9};
        System.out.println(q[0] + " " + q[1] + " " + p[0] + " " + h.data[0]);
    }
}

class Holder {
    int[] data;

    Holder(int[] data) {
        this.data = data;
    }
}
```

```output
10 20 7 10
```

**Diagram, step by step:**

| Statement | Arrows | Array A | Array B |
|---|---|---|---|
| `int[] p = {1, 2, 3}` | p → A | [1, 2, 3] | |
| `int[] q = p` | p, q → A | [1, 2, 3] | |
| `new Holder(p)` | p, q, h.data → A | [1, 2, 3] | |
| `q[0] = 10` | | [10, 2, 3] | |
| `h.data[1] = 20` | | [10, 20, 3] | |
| `p = new int[]{7, 8, 9}` | q, h.data → A; p → B | [10, 20, 3] | [7, 8, 9] |

Three arrows pointed to array A, so changes through `q` and through `h.data` both landed in the same array. Reassigning `p` moved only `p`'s arrow.

<!-- section: example -->
### Example 4: Using a Trace to Find a Bug

This method should return the average of an array, but for `{3, 4}` it returns 3.0 instead of 3.5.

```java
public class Main {
    public static void main(String[] args) {
        System.out.println(average(new int[]{3, 4}));
        System.out.println(averageFixed(new int[]{3, 4}));
    }

    public static double average(int[] a) {
        int sum = 0;
        for (int v : a) {
            sum += v;
        }
        return sum / a.length;
    }

    public static double averageFixed(int[] a) {
        int sum = 0;
        for (int v : a) {
            sum += v;
        }
        return (double) sum / a.length;
    }
}
```

```output
3.0
3.5
```

**Trace of `average({3, 4})`:** `sum` becomes 3, then 7. The return expression is `sum / a.length`, which is `7 / 2`. Both operands are `int`, so this is integer division: the result is 3, and only then is it converted to the return type `double`, giving 3.0. The trace pinpoints the exact expression at fault. The fix casts before dividing.

<!-- section: misconception -->
## Common Misconceptions

**"When tracing, I can follow what the code is supposed to do."**
A trace must follow what the code actually says. Silently fixing the code in your head hides the bug you are looking for.

**"The loop condition is checked only at the start."**
It is checked before every iteration, including the final check that ends the loop. Record that final check.

**"Variables in different method calls with the same name share a value."**
Every call has its own local variables. Keep them in separate frames.

**"Assigning one array or object variable to another creates a copy in the trace."**
Draw a second arrow to the same box. Only `new` creates a new box.

**"Testing with one typical input is enough."**
Most bugs appear at boundaries and edge cases, such as empty or single-element inputs, equal values, and exact thresholds.

**"If the program prints something, it must be right."**
Logic errors produce plausible output. Compare the actual output with a trace or an expected answer.

<!-- section: facts -->
## Key Facts

- Tracing means executing a program by hand, statement by statement, recording every change in state.
- A program's state includes variable values, array and object contents, active method calls, and output so far.
- A trace table has a column per variable and a row per change or per iteration.
- A trace must follow the code as written, not as intended.
- The final loop-condition check, which ends the loop, should appear in a trace.
- When tracing a method call, record a new frame with copies of the arguments; the caller pauses until it returns.
- The list of active frames while tracing is a hand-drawn call stack.
- Arrays and objects are traced as boxes, and reference variables as arrows to boxes.
- Two arrows to the same box mean aliasing: a change through one is visible through the other.
- Desk-checking should include typical, boundary and edge-case inputs.
- Print debugging adds temporary print statements to show state while a program runs.
- A debugger pauses at breakpoints and lets you step over or into statements while inspecting variables.

<!-- section: exercise -->
## Practice Questions

### Level 1: Recall (MCQ)

**Q1.** Which inputs are most likely to reveal an off-by-one error in a loop?
A. Large typical values  B. Boundary values, such as the smallest and largest valid inputs  C. Random values  D. Any single value

**Q2.** While tracing, the statement `int[] b = a;` runs. How should the diagram change?
A. Draw a new array for `b` with copied values  B. Draw an arrow from `b` to the same array as `a`  C. Nothing changes  D. Delete `a`'s arrow

**Q3.** In a debugger, what does "step into" do on a line containing a method call?
A. Runs the whole method and pauses on the next line  B. Pauses at the first line inside the called method  C. Ends the program  D. Skips the method

**Q4.** A trace shows the correct values at every step, but the final printed result is wrong. Which part of the program should be checked first?
A. The loop  B. The variable declarations  C. The output statement and its expression  D. The imports

### Level 2: Trace and Predict

**Q5.** What does this program print? Trace it with a table before checking.

```java
public class Main {
    public static void main(String[] args) {
        int[] a = {5, 1, 4, 2};
        int count = 0;
        for (int i = 0; i < a.length - 1; i++) {
            for (int j = 0; j < a.length - 1 - i; j++) {
                if (a[j] > a[j + 1]) {
                    int t = a[j];
                    a[j] = a[j + 1];
                    a[j + 1] = t;
                    count++;
                }
            }
        }
        System.out.println(a[0] + " " + a[1] + " " + a[2] + " " + a[3]);
        System.out.println(count);
    }
}
```

**Q6.** What does this program print?

```java
public class Main {
    static int calls = 0;

    public static void main(String[] args) {
        Pair p = new Pair(2, 3);
        Pair q = p;
        int r = work(p, 4);
        System.out.println(p.x + " " + p.y + " " + q.x + " " + r + " " + calls);
    }

    public static int work(Pair pair, int k) {
        calls++;
        pair.x = pair.x + k;
        pair = new Pair(0, 0);
        pair.y = 99;
        return helper(k) + pair.y;
    }

    public static int helper(int k) {
        calls++;
        k = k * k;
        return k;
    }
}

class Pair {
    int x;
    int y;

    Pair(int x, int y) {
        this.x = x;
        this.y = y;
    }
}
```

### Level 3: Explain

**Q7.** In Example 2, `f` changes its parameter with `n = n * 2`, yet `main` prints `x` as 4. Explain why, and explain how the call to `g(n)` inside `f` can receive 10 while a later call `g(x)` from `main` receives 4.

**Q8.** A method to count the negative numbers in an array returns 2 for `{-3, 5, -1, -8}` instead of 3. Its loop header is `for (int i = 0; i < a.length - 1; i++)`. Use a trace to explain the result, give the fix, and list three further inputs you would use to desk-check the fixed method, with the expected answer for each.

### Level 4: Implement

**Q9. Running Sum Trace.** Read `n` and then `n` integers. Print one trace line per element in the format `i=<index> value=<value> sum=<running sum>`, then a final line `Total: <sum>`.

Sample input:

```text
3
4 -2 7
```

Sample output:

```text
i=0 value=4 sum=4
i=1 value=-2 sum=2
i=2 value=7 sum=9
Total: 9
```

**Q10. Digit Reversal Trace.** Read a positive integer `n`. Reverse its digits using the `% 10` and `/ 10` method, printing one trace line per iteration in the format `n=<n before> digit=<digit> reversed=<reversed after>`, then the line `Result: <reversed>`.

Sample input:

```text
1204
```

Sample output:

```text
n=1204 digit=4 reversed=4
n=120 digit=0 reversed=40
n=12 digit=2 reversed=402
n=1 digit=1 reversed=4021
Result: 4021
```

### Level 5: Challenge

**Q11. Trace, Diagnose and Fix.** The program below is meant to read `n` and then `n` integers, and print the **1-based positions** of every occurrence of the **smallest** value, separated by spaces. It compiles but gives wrong answers. Trace it on the input `4` / `3 -2 5 -2`, list every bug you find, and write a corrected program.

<!-- nocheck -->
```java
import java.util.Scanner;

public class Main {
    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        int n = sc.nextInt();
        int[] a = new int[n];
        for (int i = 0; i < n; i++) {
            a[i] = sc.nextInt();
        }
        int min = 0;
        for (int i = 1; i < n; i++) {
            if (a[i] < min) {
                min = a[i];
            }
        }
        for (int i = 1; i < n; i++) {
            if (a[i] == min) {
                System.out.print(i + " ");
            }
        }
        System.out.println();
    }
}
```

Expected output for the sample input:

```text
2 4
```

<!-- section: solution -->
## Solutions

**Q1.** B.

**Q2.** B. No new array is created.

**Q3.** B.

**Q4.** C. If every intermediate value is correct, the fault is in how the result is computed or printed.

**Q5.**

```output
1 2 4 5
4
```

This is one pass of a well-known sorting algorithm repeated until sorted. The swaps are: (5, 1), (5, 4), (5, 2) in the first outer iteration, giving `[1, 4, 2, 5]`, then (4, 2) in the second, giving `[1, 2, 4, 5]`. No swaps happen in the third. Four swaps in total.

**Q6.**

```output
6 3 6 115 2
```

`q` is an alias of `p`. `work` adds 4 to `p.x` through the shared reference, making it 6. It then points its parameter at a new `Pair`, so setting `y` to 99 affects only that new object. `helper(4)` returns 16, so `r` is 16 + 99 = 115. `calls` is incremented once in `work` and once in `helper`.

**Q7.** Java passes arguments by value, so `f` receives a copy of `x + 1` (5) in its own parameter `n`. Doubling `n` changes only that copy; `main`'s `x` is a separate variable and stays 4. Inside `f`, the call `g(n)` passes the current value of `f`'s `n`, which is 10, into a new frame for `g`. Later, `main` calls `g(x)`, which creates a different frame for `g` whose `n` is a copy of 4. Each call has its own local variables, so the two calls to `g` do not affect each other.

**Q8.** With `i < a.length - 1`, `i` takes only the values 0, 1 and 2 for a length-4 array:

| i | a[i] | negative? | count |
|---|---|---|---|
| 0 | -3 | yes | 1 |
| 1 | 5 | no | 1 |
| 2 | -1 | yes | 2 |
| 3 | | condition `3 < 3` is false, loop ends | 2 |

The last element, -8, is never examined. The fix is `i < a.length`. Useful desk-check inputs include `{-5}` (expected 1, a single element that is negative), `{4, 9}` (expected 0, no negatives) and `{-1, -2, -3}` (expected 3, a negative in the last position and every element negative).

**Q9.**

```java
import java.util.Scanner;

public class Main {
    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        int n = sc.nextInt();
        int sum = 0;
        for (int i = 0; i < n; i++) {
            int v = sc.nextInt();
            sum += v;
            System.out.println("i=" + i + " value=" + v + " sum=" + sum);
        }
        System.out.println("Total: " + sum);
    }
}
```

```input
3
4 -2 7
```

```output
i=0 value=4 sum=4
i=1 value=-2 sum=2
i=2 value=7 sum=9
Total: 9
```

**Q10.**

```java
import java.util.Scanner;

public class Main {
    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        int n = sc.nextInt();
        int reversed = 0;
        while (n > 0) {
            int digit = n % 10;
            reversed = reversed * 10 + digit;
            System.out.println("n=" + n + " digit=" + digit + " reversed=" + reversed);
            n = n / 10;
        }
        System.out.println("Result: " + reversed);
    }
}
```

```input
1204
```

```output
n=1204 digit=4 reversed=4
n=120 digit=0 reversed=40
n=12 digit=2 reversed=402
n=1 digit=1 reversed=4021
Result: 4021
```

**Q11.** Tracing the input `3 -2 5 -2`: `min` starts at 0; the loop from `i = 1` sees -2 (min becomes -2), 5, and -2. The second loop from `i = 1` prints `1 3`. The expected output is `2 4`. The bugs are:

1. `min` starts at 0 instead of `a[0]`, which is wrong whenever every value is positive (the minimum would be reported as 0).
2. The minimum-finding loop starts at `i = 1`, which is only correct if `min` starts at `a[0]`; with `min = 0` it ignores `a[0]` entirely.
3. The printing loop starts at `i = 1`, so an occurrence at index 0 is never printed.
4. It prints 0-based indexes `i` instead of the 1-based positions `i + 1`.
5. It prints a trailing space after the last position.

```java
import java.util.Scanner;

public class Main {
    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        int n = sc.nextInt();
        int[] a = new int[n];
        for (int i = 0; i < n; i++) {
            a[i] = sc.nextInt();
        }
        int min = a[0];
        for (int i = 1; i < n; i++) {
            if (a[i] < min) {
                min = a[i];
            }
        }
        boolean first = true;
        for (int i = 0; i < n; i++) {
            if (a[i] == min) {
                if (!first) {
                    System.out.print(" ");
                }
                System.out.print(i + 1);
                first = false;
            }
        }
        System.out.println();
    }
}
```

```input
4
3 -2 5 -2
```

```output
2 4
```

<!-- section: rubric -->
## Marking Rubrics

**Q7 (Explain, 3 marks)**
- 1 mark: states that parameters receive copies, so changing `n` in `f` cannot change `x` in `main`.
- 1 mark: explains that `g(n)` inside `f` receives the current value of `f`'s `n`, which is 10.
- 1 mark: explains that each call to `g` has its own frame and its own `n`.

**Q8 (Explain, 4 marks)**
- 1 mark: a trace showing that `i` stops at 2, so index 3 is never checked.
- 1 mark: gives the fix `i < a.length`.
- 2 marks: three sensible desk-check inputs with correct expected answers, including at least one boundary case such as a negative last element or a single-element array.

**Q9 and Q10 (Implement)**
- Output matches exactly on all hidden tests, including every trace line: full marks.
- Q10 must print the value of `n` before it is divided in each line.

**Q11 (Challenge)**
- 1 mark for each correctly identified bug, up to 4 marks.
- The corrected program must pass all hidden tests, including arrays where the minimum is at index 0, where all values are positive, and where all values are equal.

<!-- section: further_practice -->
## Further Practice

- LeetCode 1768: *Merge Strings Alternately* (https://leetcode.com/problems/merge-strings-alternately/)
- LeetCode 1672: *Richest Customer Wealth* (https://leetcode.com/problems/richest-customer-wealth/)
- LeetCode 2798: *Number of Employees Who Met the Target* (https://leetcode.com/problems/number-of-employees-who-met-the-target/)
