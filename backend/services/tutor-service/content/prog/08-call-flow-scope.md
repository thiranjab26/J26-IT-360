---
concept_id: prog.call_flow
module: prog
sequence: 8
topic: Methods
title: "8. Method Call Flow and Scope"
prerequisites: [prog.methods]
cross_module_prerequisites: []
difficulty: 3
java_version: 21
version: 1
status: draft
---

# 8. Method Call Flow and Scope

<!-- section: objectives -->
## Learning Objectives

After this concept you should be able to:

1. Trace the order in which methods start and finish when methods call other methods.
2. Explain that each method call gets its own separate set of local variables.
3. Determine the scope of a variable: where in the code it can be used.
4. Distinguish local variables from static fields, including how long each one exists.
5. Predict output that depends on call order and variable scope.

<!-- section: prerequisites -->
## Before You Start

From **Methods** you need to define and call static methods, pass arguments to parameters, return values, and understand that parameters receive copies of arguments.

<!-- section: theory -->
## Theory

### What Happens During a Call

When a method is called, the **caller pauses** at the exact point of the call. The **called method** (the callee) runs from its first statement. When the callee finishes, by reaching `return` or the end of its body, execution **resumes in the caller at the point where it paused**, using the returned value if there is one.

The caller does not restart, and the rest of the caller's statements have not run yet: they run after the callee returns.

<!-- section: theory -->
### Chains of Calls

Methods can call methods that call further methods. Suppose `main` calls `a`, and `a` calls `b`:

1. `main` starts and pauses at the call to `a`.
2. `a` starts and pauses at the call to `b`.
3. `b` runs to completion and returns to `a`.
4. `a` resumes, finishes, and returns to `main`.
5. `main` resumes and finishes.

The **last method to start is the first to finish**. `b` started last and finished first; `main` started first and finishes last. This "last in, first out" order is exactly how a **stack** behaves, and Java manages calls with a structure called the **call stack**. You will study it in detail in the Data Structures and Algorithms module.

<!-- section: theory -->
### Each Call Has Its Own Local Variables

A **local variable** is declared inside a method. Parameters are local variables too. Every time a method is called, Java creates a **fresh set** of its local variables for that call. When the call returns, those variables are destroyed.

Two consequences follow:

- A local variable does **not** remember its value between calls. If `count` is a local variable set to 0 at the start of a method, it is 0 at the start of every call.
- Two different methods can each have a variable named `n`. They are unrelated variables that happen to share a name. Changing one never affects the other.

<!-- section: theory -->
### Scope

The **scope** of a variable is the region of code where its name can be used. In Java, a local variable's scope runs from its declaration to the end of the **block** (the pair of braces) in which it is declared.

```java
public static void demo(int x) {       // x: whole method
    int total = 0;                     // total: from here to end of method
    for (int i = 0; i < x; i++) {      // i: only inside the for loop
        int square = i * i;            // square: only inside the loop body
        total += square;
    }
    // i and square cannot be used here
    if (total > 10) {
        String msg = "big";            // msg: only inside this if block
        System.out.println(msg);
    }
    // msg cannot be used here
}
```

Using a variable outside its scope is a compile-time error ("cannot find symbol"). Declaring a second local variable with the same name while the first is still in scope is also a compile-time error.

A useful rule: **declare variables in the smallest scope that works.** A variable that only the loop needs belongs inside the loop.

<!-- section: theory -->
### Static Fields

A **static field** is a variable declared inside the class but **outside** any method, with the `static` modifier:

```java
public class Main {
    static int callCount = 0;     // static field

    public static void greet() {
        callCount++;
    }
}
```

A static field differs from a local variable in two ways:

| | Local variable | Static field |
|---|---|---|
| Declared | Inside a method or block | In the class, outside all methods |
| Scope | From declaration to end of its block | Every method in the class |
| Lifetime | Created at each call, destroyed when the call returns | Exists once, for the whole run of the program |
| Default value | None; must be assigned before use | 0, `false` or `null` if not initialised |

Because every method shares the same static field, it keeps its value between calls. That makes it useful for things like counters, but it also makes programs harder to follow, since any method may change it. Prefer parameters and return values, and use static fields only when data genuinely belongs to the whole program.

<!-- section: theory -->
### Shadowing

If a method declares a local variable with the same name as a static field, the local variable **shadows** the field inside that method: the name refers to the local variable. The field still exists and can be reached as `Main.fieldName`. Shadowing is legal but confusing, so avoid giving locals the same names as fields.

<!-- section: theory -->
### Tracing Calls by Hand

To trace a program with several method calls, keep a list of active calls. Add a line when a call starts, with its parameter values, and remove it when the call returns, noting the returned value. The line at the bottom is always the method currently running. This list is a hand-drawn call stack.

<!-- section: example -->
## Worked Examples

### Example 1: Start and Finish Order

```java
public class Main {
    public static void main(String[] args) {
        System.out.println("main starts");
        a();
        System.out.println("main ends");
    }

    public static void a() {
        System.out.println("  a starts");
        b();
        System.out.println("  a ends");
    }

    public static void b() {
        System.out.println("    b runs");
    }
}
```

```output
main starts
  a starts
    b runs
  a ends
main ends
```

**Active calls at each moment:**

| Moment | Active calls (bottom is running) |
|---|---|
| `main starts` printed | main |
| `a starts` printed | main, a |
| `b runs` printed | main, a, b |
| `a ends` printed | main, a |
| `main ends` printed | main |

`b` starts last and finishes first.

<!-- section: example -->
### Example 2: Values Flowing Through Calls

```java
public class Main {
    public static void main(String[] args) {
        int result = outer(3);
        System.out.println("result = " + result);
    }

    public static int outer(int n) {
        int x = inner(n + 1);
        return x * 2;
    }

    public static int inner(int n) {
        return n * n;
    }
}
```

```output
result = 32
```

**Trace:**

| Step | Call | n | Returns |
|---|---|---|---|
| 1 | `outer(3)` starts | 3 | |
| 2 | `inner(4)` starts | 4 | |
| 3 | `inner(4)` returns | 4 | 16 |
| 4 | `outer(3)` resumes: `x = 16` | 3 | 32 |
| 5 | `main` stores 32 in `result` | | |

`outer` and `inner` each have their own `n`. While `inner` runs, `inner`'s `n` is 4 and `outer`'s `n` is still 3.

<!-- section: example -->
### Example 3: Local Variables Versus a Static Field

```java
public class Main {
    static int totalCalls = 0;

    public static void main(String[] args) {
        visit();
        visit();
        visit();
        System.out.println("totalCalls = " + totalCalls);
    }

    public static void visit() {
        int localCount = 0;
        localCount++;
        totalCalls++;
        System.out.println("local = " + localCount + ", total = " + totalCalls);
    }
}
```

```output
local = 1, total = 1
local = 1, total = 2
local = 1, total = 3
totalCalls = 3
```

`localCount` is created fresh at 0 in every call, so it is always 1 when printed. `totalCalls` is a static field that exists once for the whole program, so it keeps increasing.

<!-- section: misconception -->
## Common Misconceptions

**"Methods run in the order they are written in the file."**
Methods run when they are called. A method defined first may never run at all if nothing calls it.

**"After a call returns, the caller starts again from the top."**
The caller resumes exactly where it paused.

**"A variable named `n` in one method is the same as `n` in another."**
Each method has its own local variables. The names are unrelated.

**"A local variable remembers its value from the previous call."**
Local variables are created fresh on every call and destroyed on return.

**"A variable declared inside a loop or if block can be used after it."**
Its scope ends at the closing brace of the block where it was declared.

**"When `a` calls `b`, `a` finishes before `b` starts."**
`a` pauses while `b` runs, and finishes only after `b` returns. The last method called is the first to finish.

<!-- section: facts -->
## Key Facts

- When a method is called, the caller pauses at the point of the call until the callee returns.
- After the callee returns, the caller resumes exactly where it paused.
- In a chain of calls, the last method to start is the first to finish.
- Java tracks active method calls using the call stack.
- Each method call gets its own fresh set of local variables, including parameters.
- Local variables are destroyed when their method call returns.
- Local variables with the same name in different methods are different variables.
- The scope of a local variable runs from its declaration to the end of the enclosing block.
- A variable declared in a `for` header or loop body is not accessible after the loop.
- Using a variable outside its scope is a compile-time error.
- A static field is declared in the class outside all methods and is shared by every method.
- A static field exists for the whole run of the program and keeps its value between calls.
- Static fields receive default values (0, `false` or `null`); local variables do not.
- A local variable with the same name as a static field shadows the field inside that method.

<!-- section: exercise -->
## Practice Questions

### Level 1: Recall (MCQ)

**Q1.** `main` calls `p`, and `p` calls `q`. Which method finishes first?
A. `main`  B. `p`  C. `q`  D. They finish at the same time

**Q2.** A method declares `int count = 0;` and increments it. What is `count` at the start of the method's third call?
A. 0  B. 2  C. 3  D. It depends on the caller

**Q3.** Where can a variable declared inside a `for` loop's body be used?
A. Anywhere in the method  B. Anywhere in the class  C. Only inside the loop body  D. Only after the loop

**Q4.** What is the main difference in lifetime between a static field and a local variable?
A. None  B. A static field exists for the whole program; a local exists only during its method call  C. A local variable exists for the whole program  D. A static field is destroyed after each call

### Level 2: Trace and Predict

**Q5.** What does this program print?

```java
public class Main {
    public static void main(String[] args) {
        System.out.println("A");
        first();
        System.out.println("F");
    }

    public static void first() {
        System.out.println("B");
        second();
        System.out.println("D");
        second();
    }

    public static void second() {
        System.out.println("C");
    }
}
```

**Q6.** What does this program print?

```java
public class Main {
    static int n = 100;

    public static void main(String[] args) {
        int n = 5;
        change(n);
        System.out.println(n + " " + Main.n);
        System.out.println(calc(n) + " " + Main.n);
    }

    public static void change(int n) {
        n = n + 1;
        Main.n = Main.n + 1;
    }

    public static int calc(int x) {
        int n = x * 2;
        return n + Main.n;
    }
}
```

### Level 3: Explain

**Q7.** A student wants a method to count how many times it has been called, and writes:

```java
public static void tick() {
    int calls = 0;
    calls++;
    System.out.println("Called " + calls + " times");
}
```

Every call prints `Called 1 times`. Explain why, and show how to fix it.

**Q8.** Explain what "the last method to start is the first to finish" means, using a program where `main` calls `load`, and `load` calls `parse`.

### Level 4: Implement

**Q9. Box of Characters.** Write `printRow(int width, char c)`, which prints `c` repeated `width` times followed by a newline, and `printBox(int width, int height, char c)`, which calls `printRow` `height` times. Read the width, the height and a character, and call `printBox`.

Sample input:

```text
5 3 #
```

Sample output:

```text
#####
#####
#####
```

**Q10. Running Balance.** Use a static field `balance`, starting at 0. Write `deposit(int amount)`, which adds `amount` to `balance`, and `withdraw(int amount)`, which subtracts `amount` only if `balance` is at least `amount` and otherwise prints `Insufficient funds`. Read a number `k`, then `k` operations, each a letter `D` or `W` followed by an amount. After each operation print `Balance: <balance>`.

Sample input:

```text
4
D 500
W 200
W 400
D 100
```

Sample output:

```text
Balance: 500
Balance: 300
Insufficient funds
Balance: 300
Balance: 400
```

### Level 5: Challenge

**Q11. GCD and LCM with a Step Counter.** Write `gcd(int a, int b)` using Euclid's algorithm with a loop: while `b` is not 0, replace `(a, b)` with `(b, a % b)`; then `a` is the greatest common divisor. Count each loop iteration in a static field `steps`. Write `lcm(int a, int b)` that returns `a / gcd(a, b) * b`. Read two positive integers, then print their GCD, their LCM, and the total value of `steps` after both calls, on three lines.

Sample input:

```text
48 18
```

Sample output:

```text
GCD: 6
LCM: 144
Steps: 6
```

<!-- section: solution -->
## Solutions

**Q1.** C.

**Q2.** A. The local variable is created fresh as 0 on every call.

**Q3.** C.

**Q4.** B.

**Q5.**

```output
A
B
C
D
C
F
```

`main` prints `A` and pauses. `first` prints `B`, pauses while `second` prints `C`, prints `D`, and calls `second` again, which prints `C`. Only then does `first` return, and `main` prints `F`.

**Q6.**

```output
5 101
111 101
```

`change` receives a copy of the local `n` (5), so `main`'s `n` stays 5, but `Main.n` is the static field and becomes 101. In `calc(5)`, the local `n` is 10 and the method returns `10 + 101`, which is 111.

**Q7.** `calls` is a local variable, so every call creates a new `calls` set to 0, increments it to 1, prints it, and destroys it when the method returns. To remember the value between calls, it must be a static field declared outside the method:

```java
static int calls = 0;

public static void tick() {
    calls++;
    System.out.println("Called " + calls + " times");
}
```

**Q8.** When `main` calls `load`, `main` pauses. When `load` calls `parse`, `load` pauses too, so three calls are active. `parse` started last, and it must finish before `load` can continue; `load` must then finish before `main` can continue. So the order of finishing is `parse`, then `load`, then `main`: the reverse of the order in which they started.

**Q9.**

```java
import java.util.Scanner;

public class Main {
    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        int width = sc.nextInt();
        int height = sc.nextInt();
        char c = sc.next().charAt(0);
        printBox(width, height, c);
    }

    public static void printRow(int width, char c) {
        for (int i = 0; i < width; i++) {
            System.out.print(c);
        }
        System.out.println();
    }

    public static void printBox(int width, int height, char c) {
        for (int r = 0; r < height; r++) {
            printRow(width, c);
        }
    }
}
```

```input
5 3 #
```

```output
#####
#####
#####
```

**Q10.**

```java
import java.util.Scanner;

public class Main {
    static int balance = 0;

    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        int k = sc.nextInt();
        for (int i = 0; i < k; i++) {
            char op = sc.next().charAt(0);
            int amount = sc.nextInt();
            if (op == 'D') {
                deposit(amount);
            } else {
                withdraw(amount);
            }
            System.out.println("Balance: " + balance);
        }
    }

    public static void deposit(int amount) {
        balance += amount;
    }

    public static void withdraw(int amount) {
        if (balance >= amount) {
            balance -= amount;
        } else {
            System.out.println("Insufficient funds");
        }
    }
}
```

```input
4
D 500
W 200
W 400
D 100
```

```output
Balance: 500
Balance: 300
Insufficient funds
Balance: 300
Balance: 400
```

**Q11.**

```java
import java.util.Scanner;

public class Main {
    static int steps = 0;

    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        int a = sc.nextInt();
        int b = sc.nextInt();
        System.out.println("GCD: " + gcd(a, b));
        System.out.println("LCM: " + lcm(a, b));
        System.out.println("Steps: " + steps);
    }

    public static int gcd(int a, int b) {
        while (b != 0) {
            int temp = a % b;
            a = b;
            b = temp;
            steps++;
        }
        return a;
    }

    public static int lcm(int a, int b) {
        return a / gcd(a, b) * b;
    }
}
```

```input
48 18
```

```output
GCD: 6
LCM: 144
Steps: 6
```

`gcd(48, 18)` takes 3 iterations: (48, 18) to (18, 12) to (12, 6) to (6, 0). It is called twice, once directly and once inside `lcm`, so `steps` is 6. Dividing before multiplying in `lcm` keeps intermediate values small.

<!-- section: rubric -->
## Marking Rubrics

**Q7 (Explain, 3 marks)**
- 1 mark: identifies that `calls` is a local variable.
- 1 mark: explains that local variables are created fresh on each call and destroyed on return, so the count never accumulates.
- 1 mark: gives the fix of moving the counter to a static field.

**Q8 (Explain, 3 marks)**
- 1 mark: states that each caller pauses while the method it called runs.
- 1 mark: states that `parse` must finish before `load`, and `load` before `main`.
- 1 mark: concludes that the finishing order is the reverse of the starting order.

**Q9 to Q11 (Implement and Challenge)**
- Output matches exactly on all hidden tests: full marks.
- Q9's `printBox` must call `printRow`. Q10 must keep the balance in a static field and use the two methods. Q11's `lcm` must call `gcd`, and `steps` must count loop iterations across both calls.

<!-- section: further_practice -->
## Further Practice

- LeetCode 1979: *Find Greatest Common Divisor of Array* (https://leetcode.com/problems/find-greatest-common-divisor-of-array/) (uses arrays from concept 9)
- HackerRank, Java: *Java Static Initializer Block* (https://www.hackerrank.com/challenges/java-static-initializer-block/problem)
