---
concept_id: prog.methods
module: prog
sequence: 7
topic: Methods
title: "7. Methods"
prerequisites: [prog.variables_types]
cross_module_prerequisites: []
difficulty: 2
java_version: 21
version: 1
status: draft
---

# 7. Methods

<!-- section: objectives -->
## Learning Objectives

After this concept you should be able to:

1. Define static methods with parameters and a return type, and call them.
2. Distinguish parameters from arguments, and methods that return a value from `void` methods.
3. Explain pass-by-value and predict its effect on the caller's variables.
4. Use `return` correctly, including early returns and returns on every path.
5. Overload a method and explain how Java chooses which version to call.

<!-- section: prerequisites -->
## Before You Start

From **Variables and Data Types** you need to declare typed variables. You will also use conditionals and loops from earlier concepts inside method bodies.

<!-- section: theory -->
## Theory

### Why Methods

A **method** is a named block of code that performs one task and can be run, or **called**, whenever needed. Methods let you:

- **Avoid repetition.** Write the logic once and call it many times.
- **Decompose problems.** Split a large task into small, named steps.
- **Test in isolation.** A method with clear inputs and outputs can be checked on its own.
- **Read code more easily.** `if (isLeapYear(year))` says what it does; the leap year formula does not.

You have used methods from the start: `main` is a method, and `System.out.println` and `Math.max` are methods written by others.

<!-- section: theory -->
### Anatomy of a Method

```java
public static int square(int x) {
    return x * x;
}
```

| Part | In the example | Meaning |
|---|---|---|
| Modifiers | `public static` | `public`: usable from other classes. `static`: belongs to the class itself, so it can be called without creating an object |
| Return type | `int` | The type of value the method gives back |
| Name | `square` | Used to call the method. Convention: camelCase verb or question |
| Parameter list | `(int x)` | Variables that receive the input values |
| Body | `{ return x * x; }` | The statements that run when the method is called |

The name together with the parameter types is the method's **signature**. In this module all methods are `public static`, like `main`. The full meaning of `static` becomes clear in the concept on classes and objects.

Methods are written inside the class but **outside** other methods. Their order in the class does not matter: `main` can call a method defined below it.

<!-- section: theory -->
### Calling a Method

```java
int result = square(7);        // result is 49
System.out.println(square(3)); // prints 9
int total = square(2) + square(4);   // 4 + 16 = 20
```

A call evaluates to the method's return value, so it can be used anywhere a value of that type is allowed. When a method is called:

1. Each **argument** (the value in the call) is evaluated.
2. The values are copied into the matching **parameters**, in order.
3. The body runs.
4. `return` sends a value back, and execution continues where the call was made.

The call must supply the right **number** of arguments of compatible **types** in the right **order**. `square("7")` and `square(1, 2)` do not compile.

<!-- section: theory -->
### Parameters Versus Arguments

A **parameter** is the variable declared in the method header: `x` in `square(int x)`. An **argument** is the actual value passed in a call: `7` in `square(7)`. A method may have several parameters, separated by commas, each with its own type: `static double area(double width, double height)`.

<!-- section: theory -->
### Return Values and void

A method with a return type other than `void` **must** return a value of that type on every possible path through its body. If any path could reach the end without a `return`, compilation fails with "missing return statement".

```java
static String sign(int n) {
    if (n > 0) {
        return "positive";
    } else if (n < 0) {
        return "negative";
    }
    return "zero";       // needed: covers the remaining path
}
```

A `void` method returns no value. It performs an action, such as printing. It may use `return;` with no value to finish early. Calling a `void` method where a value is expected, such as `int x = printLine();`, does not compile.

`return` **ends the method immediately**. Statements after a `return` on the same path never run.

<!-- section: theory -->
### Pass-by-Value

Java passes arguments **by value**: the parameter receives a **copy** of the argument's value. Changing a parameter inside the method does not change the caller's variable.

```java
static void addTen(int n) {
    n = n + 10;      // changes only the copy
}

int score = 5;
addTen(score);
// score is still 5
```

To give a result back to the caller, return it: `score = addTenAndReturn(score);`. How pass-by-value behaves when the value is a reference to an object is covered in the concept on references.

<!-- section: theory -->
### Overloading

Several methods in the same class can share a name if their **parameter lists differ** in number or types. This is **overloading**. Java picks the version whose parameters match the arguments.

```java
static int max(int a, int b) { return a > b ? a : b; }
static int max(int a, int b, int c) { return max(max(a, b), c); }
static double max(double a, double b) { return a > b ? a : b; }
```

The return type alone cannot distinguish two methods: two methods with the same name and parameter types but different return types do not compile.

<!-- section: theory -->
### Designing Good Methods

- **One task per method.** If the name needs "and", consider splitting it.
- **Return values rather than printing them**, unless printing is the task. A method that returns can be reused in calculations; a method that prints cannot.
- **Name booleans as questions:** `isPrime`, `hasPassed`.

<!-- section: example -->
## Worked Examples

### Example 1: Methods That Return Values

```java
public class Main {
    public static void main(String[] args) {
        System.out.println(square(6));
        System.out.println(isEven(7));
        System.out.println(average(70, 81));
        int total = square(2) + square(3);
        System.out.println(total);
    }

    public static int square(int x) {
        return x * x;
    }

    public static boolean isEven(int n) {
        return n % 2 == 0;
    }

    public static double average(int a, int b) {
        return (a + b) / 2.0;
    }
}
```

```output
36
false
75.5
13
```

`isEven` returns the boolean expression directly; there is no need for `if (n % 2 == 0) return true; else return false;`. `average` divides by `2.0` to avoid integer division.

<!-- section: example -->
### Example 2: Pass-by-Value

```java
public class Main {
    public static void main(String[] args) {
        int score = 5;
        tryToChange(score);
        System.out.println("After tryToChange: " + score);
        score = addTen(score);
        System.out.println("After addTen: " + score);
    }

    public static void tryToChange(int n) {
        n = n + 10;
        System.out.println("Inside: " + n);
    }

    public static int addTen(int n) {
        return n + 10;
    }
}
```

```output
Inside: 15
After tryToChange: 5
After addTen: 15
```

**Trace:** `tryToChange(score)` copies 5 into `n`. The method changes `n` to 15 and prints it, but `score` in `main` is a separate variable and stays 5. `addTen` returns 15, and the assignment `score = ...` stores it.

<!-- section: example -->
### Example 3: Early Return and void Methods

```java
public class Main {
    public static void main(String[] args) {
        printRating(92);
        printRating(55);
        printRating(-4);
    }

    public static void printRating(int mark) {
        if (mark < 0 || mark > 100) {
            System.out.println("Invalid mark");
            return;
        }
        System.out.println(mark + ": " + rating(mark));
    }

    public static String rating(int mark) {
        if (mark >= 75) {
            return "Excellent";
        }
        if (mark >= 40) {
            return "Pass";
        }
        return "Fail";
    }
}
```

```output
92: Excellent
55: Pass
Invalid mark
```

`printRating` uses `return;` to stop early for invalid marks. `rating` returns as soon as a condition matches, so it needs no `else`: once a `return` runs, nothing below it executes.

<!-- section: example -->
### Example 4: Overloading

```java
public class Main {
    public static void main(String[] args) {
        System.out.println(max(4, 9));
        System.out.println(max(4, 9, 2));
        System.out.println(max(2.5, 1.5));
    }

    public static int max(int a, int b) {
        return a > b ? a : b;
    }

    public static int max(int a, int b, int c) {
        return max(max(a, b), c);
    }

    public static double max(double a, double b) {
        return a > b ? a : b;
    }
}
```

```output
9
9
2.5
```

Java chooses the version by the number and types of arguments. The three-argument version reuses the two-argument one.

<!-- section: misconception -->
## Common Misconceptions

**"Changing a parameter changes the caller's variable."**
The parameter holds a copy. Changes to it are invisible to the caller unless the value is returned and assigned.

**"`return` and printing do the same thing."**
`return` hands a value back to the calling code, which can store or use it. Printing only displays text; the caller receives nothing.

**"A method can be defined inside `main`."**
Methods are defined inside the class, alongside `main`, never inside another method.

**"A method must be defined before it is called."**
Order inside a class does not matter.

**"Code after a `return` still runs."**
`return` ends the method immediately.

**"If all my `if` branches return, the compiler knows the method always returns."**
If the compiler can see a path with no `return`, such as an `if` without an `else`, it reports "missing return statement".

**"Overloaded methods can differ only in return type."**
They must differ in their parameter lists.

<!-- section: facts -->
## Key Facts

- A method is a named block of code that performs a task and runs when called.
- A method header contains modifiers, a return type, a name and a parameter list.
- A method's signature is its name together with its parameter types.
- A `static` method can be called without creating an object.
- Methods are defined inside a class but outside other methods, in any order.
- Parameters are declared in the method header; arguments are the values passed in a call.
- Arguments must match the parameters in number, type and order.
- A non-`void` method must return a value of its return type on every path.
- A `void` method returns no value and may use `return;` to end early.
- `return` ends the method immediately.
- Java passes arguments by value: parameters receive copies.
- Changing a primitive parameter does not affect the caller's variable.
- Overloaded methods share a name but have different parameter lists.
- Methods cannot be overloaded by return type alone.

<!-- section: exercise -->
## Practice Questions

### Level 1: Recall (MCQ)

**Q1.** In `public static double area(double r)`, what is `double` immediately before `area`?
A. A parameter  B. The return type  C. A modifier  D. An argument

**Q2.** Which call is valid for `static int add(int a, int b)`?
A. `add(3)`  B. `add(3, 4.5)`  C. `add(3, 4)`  D. `add("3", "4")`

**Q3.** What happens to statements after a `return` in the same block?
A. They run after the method returns  B. They never run  C. They run only in `void` methods  D. They cause a runtime error

**Q4.** Which pair of methods is a valid overload?
A. `int f(int x)` and `double f(int x)`  B. `int f(int x)` and `int f(int y)`  C. `int f(int x)` and `int f(double x)`  D. `int f(int x)` and `int g(int x)`

### Level 2: Trace and Predict

**Q5.** What does this program print?

```java
public class Main {
    public static void main(String[] args) {
        int a = 3;
        int b = change(a);
        System.out.println(a + " " + b);
        System.out.println(twice(twice(a)));
    }

    public static int change(int a) {
        a = a * 4;
        return a - 1;
    }

    public static int twice(int n) {
        return n * 2;
    }
}
```

**Q6.** What does this program print?

```java
public class Main {
    public static void main(String[] args) {
        System.out.println(classify(0));
        System.out.println(classify(7));
        System.out.println(classify(12));
    }

    public static String classify(int n) {
        if (n == 0) {
            return "zero";
        }
        if (n % 2 == 0) {
            return "even";
        }
        String result = "odd";
        if (n > 5) {
            result = result + " and large";
        }
        return result;
    }
}
```

### Level 3: Explain

**Q7.** A student writes a method `static void doubleIt(int x) { x = x * 2; }`, calls `doubleIt(score)` and is surprised that `score` has not changed. Explain why, and rewrite the method and call so that `score` is doubled.

**Q8.** Explain why this method does not compile, and fix it.

```java
static String grade(int mark) {
    if (mark >= 50) {
        return "Pass";
    } else if (mark < 50) {
        return "Fail";
    }
}
```

### Level 4: Implement

**Q9. Temperature Conversion.** Write a method `celsiusToFahrenheit(double c)` that returns `c * 9 / 5 + 32`. In `main`, read a Celsius temperature and print the result of calling the method.

Sample input:

```text
37.5
```

Sample output:

```text
99.5
```

**Q10. Largest of Three.** Write `max(int a, int b)` and `max(int a, int b, int c)`, where the three-argument version must call the two-argument version. Read three integers and print the largest.

Sample input:

```text
-4 -9 -1
```

Sample output:

```text
-1
```

### Level 5: Challenge

**Q11. Harshad Numbers.** A Harshad number is divisible by the sum of its digits (18 is Harshad because 1 + 8 = 9 and 18 is divisible by 9). Write `digitSum(int n)` and `isHarshad(int n)`, where `isHarshad` calls `digitSum`. Read `n` and print every Harshad number from 1 to `n` separated by single spaces, then on the next line print how many there were.

Sample input:

```text
25
```

Sample output:

```text
1 2 3 4 5 6 7 8 9 10 12 18 20 21 24
15
```

<!-- section: solution -->
## Solutions

**Q1.** B.

**Q2.** C. A and D have the wrong number or types of arguments; B passes a `double` where an `int` is required, which would lose information.

**Q3.** B.

**Q4.** C. A differs only in return type, B has identical parameter types (names do not count), and D uses two different names, so it is not overloading.

**Q5.**

```output
3 11
12
```

`change` receives a copy of `a`, so `a` in `main` stays 3. Inside `change` the copy becomes 12 and the method returns 11. `twice(3)` is 6, and `twice(6)` is 12.

**Q6.**

```output
zero
odd and large
even
```

For 0 the first `return` runs. For 7, neither of the first two conditions holds, so `result` becomes `"odd and large"`. For 12 the method returns `"even"` before reaching the rest of the body.

**Q7.** Java passes arguments by value, so `x` is a copy of `score`. Doubling `x` changes only the copy, which is discarded when the method ends. The method must return the new value, and the caller must store it:

```java
static int doubleIt(int x) {
    return x * 2;
}

score = doubleIt(score);
```

**Q8.** The compiler does not reason that `mark >= 50` and `mark < 50` cover every case. It sees that if both conditions were false, execution would reach the end of the method without a `return`, so it reports "missing return statement". Replace the `else if` with a plain `else`:

```java
static String grade(int mark) {
    if (mark >= 50) {
        return "Pass";
    } else {
        return "Fail";
    }
}
```

**Q9.**

```java
import java.util.Scanner;

public class Main {
    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        double c = sc.nextDouble();
        System.out.println(celsiusToFahrenheit(c));
    }

    public static double celsiusToFahrenheit(double c) {
        return c * 9 / 5 + 32;
    }
}
```

```input
37.5
```

```output
99.5
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
        System.out.println(max(a, b, c));
    }

    public static int max(int a, int b) {
        return a > b ? a : b;
    }

    public static int max(int a, int b, int c) {
        return max(max(a, b), c);
    }
}
```

```input
-4 -9 -1
```

```output
-1
```

**Q11.**

```java
import java.util.Scanner;

public class Main {
    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        int n = sc.nextInt();
        int count = 0;
        for (int i = 1; i <= n; i++) {
            if (isHarshad(i)) {
                if (count > 0) {
                    System.out.print(" ");
                }
                System.out.print(i);
                count++;
            }
        }
        System.out.println();
        System.out.println(count);
    }

    public static int digitSum(int n) {
        int sum = 0;
        while (n > 0) {
            sum += n % 10;
            n /= 10;
        }
        return sum;
    }

    public static boolean isHarshad(int n) {
        return n % digitSum(n) == 0;
    }
}
```

```input
25
```

```output
1 2 3 4 5 6 7 8 9 10 12 18 20 21 24
15
```

`digitSum` changes its parameter `n` while extracting digits. This is safe, because `n` is a copy: the loop variable `i` in `main` is unaffected.

<!-- section: rubric -->
## Marking Rubrics

**Q7 (Explain, 3 marks)**
- 1 mark: states that Java passes arguments by value, so the parameter is a copy.
- 1 mark: states that changing the copy does not affect the caller's variable.
- 1 mark: gives a corrected method that returns the new value and a call that assigns it.

**Q8 (Explain, 2 marks)**
- 1 mark: explains that the compiler sees a possible path with no `return` ("missing return statement").
- 1 mark: gives a fix, such as replacing `else if` with `else` or adding a final `return`.

**Q9 to Q11 (Implement and Challenge)**
- Output matches exactly on all hidden tests: full marks.
- The required methods must exist with the specified names and be called; logic written only in `main` receives partial marks.
- Q10's three-argument method must call the two-argument method. Q11's `isHarshad` must call `digitSum`.

<!-- section: further_practice -->
## Further Practice

- LeetCode 2235: *Add Two Integers* (https://leetcode.com/problems/add-two-integers/) (practise the method signature form used by LeetCode)
- LeetCode 1281: *Subtract the Product and Sum of Digits of an Integer* (https://leetcode.com/problems/subtract-the-product-and-sum-of-digits-of-an-integer/)
- LeetCode 258: *Add Digits* (https://leetcode.com/problems/add-digits/)
