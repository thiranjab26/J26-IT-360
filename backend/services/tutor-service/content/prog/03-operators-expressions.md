---
concept_id: prog.operators_expressions
module: prog
sequence: 3
topic: Basics
title: "3. Operators and Expressions"
prerequisites: [prog.variables_types]
cross_module_prerequisites: []
difficulty: 1
java_version: 21
version: 1
status: draft
---

# 3. Operators and Expressions

<!-- section: objectives -->
## Learning Objectives

After this concept you should be able to:

1. Evaluate arithmetic expressions, including integer division and the remainder operator.
2. Apply operator precedence and use parentheses to control evaluation order.
3. Use compound assignment and increment operators.
4. Write boolean expressions with relational and logical operators.
5. Use common `Math` methods.

<!-- section: prerequisites -->
## Before You Start

From **Variables and Data Types** you need to know how to declare `int`, `double` and `boolean` variables, and that assigning a `double` to an `int` requires a cast that truncates.

<!-- section: theory -->
## Theory

### Expressions

An **expression** is a combination of values, variables and operators that Java evaluates to produce a single value. `3 + 4`, `price * quantity` and `age >= 18` are all expressions. The **type** of an expression depends on its operands: `3 + 4` is an `int`, `3.0 + 4` is a `double`, and `age >= 18` is a `boolean`.

<!-- section: theory -->
### Arithmetic Operators

| Operator | Meaning | Example | Result |
|---|---|---|---|
| `+` | Addition | `7 + 2` | `9` |
| `-` | Subtraction | `7 - 2` | `5` |
| `*` | Multiplication | `7 * 2` | `14` |
| `/` | Division | `7 / 2` | `3` |
| `%` | Remainder | `7 % 2` | `1` |

<!-- section: theory -->
### Integer Division

When **both** operands of `/` are integers, Java performs **integer division**: the result is an integer and the fractional part is discarded. `7 / 2` is `3`, not `3.5`. `-7 / 2` is `-3`, because the result is truncated toward zero.

If **at least one** operand is a `double`, the division is floating-point: `7 / 2.0`, `7.0 / 2` and `(double) 7 / 2` are all `3.5`.

A common trap: `(double) (7 / 2)` is `3.0`, because the integer division happens first inside the parentheses and only the result is converted.

<!-- section: theory -->
### The Remainder Operator

`a % b` gives the remainder after dividing `a` by `b`. It is not a percentage. It is useful for:

- **Even or odd:** `n % 2` is `0` for even numbers and `1` for positive odd numbers.
- **Last digit:** `n % 10` is the last digit of a positive integer, and `n / 10` removes that digit.
- **Unit conversion:** `totalSeconds / 60` gives whole minutes and `totalSeconds % 60` gives the leftover seconds.

<!-- section: theory -->
### Precedence and Associativity

Java evaluates operators in a fixed order of **precedence**:

1. Parentheses `( )`
2. Unary operators such as `-x`, `!`, `++`, `--` and casts
3. `*`, `/`, `%`
4. `+`, `-`
5. Relational `<`, `>`, `<=`, `>=`
6. Equality `==`, `!=`
7. Logical AND `&&`
8. Logical OR `||`
9. Assignment `=`, `+=` and similar

Operators on the same level are evaluated **left to right**, except assignment, which works right to left. So `2 + 3 * 4` is `14`, `(2 + 3) * 4` is `20`, and `20 / 4 * 2` is `10`, because `20 / 4` is evaluated first.

When in doubt, use parentheses. They cost nothing and make intent clear.

<!-- section: theory -->
### Compound Assignment, Increment and Decrement

| Form | Equivalent to |
|---|---|
| `x += 5` | `x = x + 5` |
| `x -= 5` | `x = x - 5` |
| `x *= 5` | `x = x * 5` |
| `x /= 5` | `x = x / 5` |
| `x %= 5` | `x = x % 5` |
| `x++` or `++x` | `x = x + 1` |
| `x--` or `--x` | `x = x - 1` |

As a standalone statement, `x++` and `++x` do the same thing. They differ only inside a larger expression: `x++` (postfix) uses the old value and then increments, while `++x` (prefix) increments first and then uses the new value. If `x` is `5`, then `int y = x++;` sets `y` to `5` and `x` to `6`, while `int z = ++x;` would increment first. To keep code readable, use `++` as a standalone statement.

<!-- section: theory -->
### Relational Operators

Relational operators compare two values and produce a `boolean`.

| Operator | Meaning |
|---|---|
| `==` | Equal to |
| `!=` | Not equal to |
| `<`, `>` | Less than, greater than |
| `<=`, `>=` | Less than or equal to, greater than or equal to |

`==` compares numbers and characters correctly. **Do not use `==` to compare Strings.** Use `s1.equals(s2)` instead. The reason is explained in the concept on references.

<!-- section: theory -->
### Logical Operators

| Operator | Meaning | True when |
|---|---|---|
| `&&` | AND | Both sides are true |
| `\|\|` | OR | At least one side is true |
| `!` | NOT | The operand is false |

`&&` and `||` are **short-circuit** operators. `&&` stops as soon as the left side is `false`, because the result must be `false`. `||` stops as soon as the left side is `true`. This lets you write safe checks such as `count != 0 && total / count > 50`, where the division only happens when `count` is not zero.

To test whether a value lies in a range, combine two comparisons: `mark >= 40 && mark <= 100`. The mathematical form `40 <= mark <= 100` does not compile in Java.

<!-- section: theory -->
### Useful Math Methods

| Method | Returns |
|---|---|
| `Math.abs(x)` | Absolute value |
| `Math.max(a, b)`, `Math.min(a, b)` | Larger or smaller of two values |
| `Math.pow(a, b)` | `a` raised to the power `b`, as a `double` |
| `Math.sqrt(x)` | Square root, as a `double` |
| `Math.round(x)` | `x` rounded to the nearest whole number (a `long` for a `double` argument) |

<!-- section: theory -->
### Division by Zero

Integer division by zero, such as `5 / 0`, throws an `ArithmeticException` at runtime and stops the program. Floating-point division by zero does not throw: `5.0 / 0` evaluates to `Infinity`.

<!-- section: example -->
## Worked Examples

### Example 1: Converting Seconds

```java
public class Main {
    public static void main(String[] args) {
        int totalSeconds = 3725;
        int hours = totalSeconds / 3600;
        int remaining = totalSeconds % 3600;
        int minutes = remaining / 60;
        int seconds = remaining % 60;
        System.out.println(hours + "h " + minutes + "m " + seconds + "s");
    }
}
```

```output
1h 2m 5s
```

**Trace:** `3725 / 3600` is `1` hour. `3725 % 3600` leaves `125` seconds. `125 / 60` is `2` minutes, and `125 % 60` is `5` seconds.

<!-- section: example -->
### Example 2: Integer Versus Floating-Point Division

```java
public class Main {
    public static void main(String[] args) {
        int a = 7;
        int b = 2;
        System.out.println(a / b);
        System.out.println(a % b);
        System.out.println(a / 2.0);
        System.out.println((double) a / b);
        System.out.println((double) (a / b));
        System.out.println(2 + 3 * 4);
        System.out.println((2 + 3) * 4);
    }
}
```

```output
3
1
3.5
3.5
3.0
14
20
```

The cast `(double) a / b` applies to `a` before the division, so the division is floating-point. In `(double) (a / b)` the integer division happens first, giving `3`, which then becomes `3.0`.

<!-- section: example -->
### Example 3: Boolean Expressions and Compound Assignment

```java
public class Main {
    public static void main(String[] args) {
        int mark = 72;
        boolean passed = mark >= 40;
        boolean distinction = mark >= 75;
        boolean inRange = mark >= 0 && mark <= 100;
        System.out.println(passed + " " + distinction + " " + inRange);

        int score = 10;
        score += 5;
        score *= 2;
        score--;
        System.out.println(score);

        System.out.println(Math.max(3, 9) + " " + Math.sqrt(16) + " " + Math.pow(2, 10));
    }
}
```

```output
true false true
29
9 4.0 1024.0
```

`score` goes from `10` to `15`, then `30`, then `29`. `Math.sqrt` and `Math.pow` return `double` values, so they print with a decimal point.

<!-- section: misconception -->
## Common Misconceptions

**"`7 / 2` is `3.5`."**
Both operands are integers, so the result is the integer `3`. Make one operand a `double` to get `3.5`.

**"`%` calculates a percentage."**
`%` is the remainder operator. `10 % 3` is `1`.

**"`=` and `==` are interchangeable."**
`=` assigns a value. `==` compares two values and produces a `boolean`.

**"`(double) (7 / 2)` gives `3.5`."**
The expression inside the parentheses is evaluated first as integer division, giving `3`, which then becomes `3.0`.

**"`&&` always evaluates both sides."**
It stops when the left side is `false`. `||` stops when the left side is `true`.

**"`40 <= mark <= 100` checks a range."**
This does not compile. Write `mark >= 40 && mark <= 100`.

**"Strings can be compared with `==`."**
Use `equals`. `==` checks something different for objects, as explained in the concept on references.

**"Dividing by zero always crashes."**
Integer division by zero throws `ArithmeticException`, but `double` division by zero gives `Infinity`.

<!-- section: facts -->
## Key Facts

- An expression evaluates to a single value with a type.
- When both operands of `/` are integers, the result is an integer with the fractional part discarded.
- Integer division truncates toward zero: `-7 / 2` is `-3`.
- If either operand of `/` is a `double`, the division is floating-point.
- `%` gives the remainder of a division.
- `n % 2 == 0` tests whether an integer is even.
- `n % 10` gives the last digit of a positive integer, and `n / 10` removes it.
- `*`, `/` and `%` have higher precedence than `+` and `-`.
- Operators of equal precedence are evaluated left to right.
- Parentheses override precedence.
- `x += 5` is equivalent to `x = x + 5`.
- `x++` uses the old value in an expression; `++x` uses the new value.
- Relational operators produce `boolean` values.
- Strings must be compared with `equals`, not `==`.
- `&&` is true only when both operands are true; `||` is true when at least one operand is true.
- `&&` and `||` short-circuit: the right operand is skipped when the left operand decides the result.
- `Math.pow` and `Math.sqrt` return `double` values.
- Integer division by zero throws `ArithmeticException`; `double` division by zero gives `Infinity`.

<!-- section: exercise -->
## Practice Questions

### Level 1: Recall (MCQ)

**Q1.** What is the value of `17 / 5`?
A. 3.4  B. 3  C. 4  D. 2

**Q2.** What is the value of `17 % 5`?
A. 3  B. 2  C. 3.4  D. 0

**Q3.** What is the value of `2 + 6 / 3 * 2`?
A. 6  B. 5.33  C. 3  D. 8

**Q4.** Which expression is `true` when `x` is between 1 and 10 inclusive?
A. `1 <= x <= 10`  B. `x >= 1 || x <= 10`  C. `x >= 1 && x <= 10`  D. `x > 1 && x < 10`

### Level 2: Trace and Predict

**Q5.** What does this program print?

```java
public class Main {
    public static void main(String[] args) {
        int x = 14;
        int y = 4;
        System.out.println(x / y);
        System.out.println(x % y);
        System.out.println((double) x / y);
        x -= y;
        y *= 3;
        System.out.println(x + " " + y);
        System.out.println(x > y && x / 0 > 1);
    }
}
```

**Q6.** What does this program print?

```java
public class Main {
    public static void main(String[] args) {
        int n = 4721;
        int last = n % 10;
        n = n / 10;
        int secondLast = n % 10;
        boolean even = last % 2 == 0;
        System.out.println(last + " " + secondLast + " " + n);
        System.out.println(even);
    }
}
```

### Level 3: Explain

**Q7.** A student calculates an average with `double avg = (a + b + c) / 3;` where `a`, `b` and `c` are `int` variables holding 70, 75 and 80. The expected answer is 75.0, which they get, but with 70, 75 and 81 they get 75.0 instead of 75.33. Explain why, and give a fix.

**Q8.** Explain why `count != 0 && total / count > 50` never throws an `ArithmeticException`, even when `count` is zero.

### Level 4: Implement

**Q9. Time Breakdown.** Read a whole number of seconds. Print it as hours, minutes and seconds in the format `H:M:S`, without leading zeros.

Sample input:

```text
7384
```

Sample output:

```text
2:3:4
```

**Q10. Digit Sum.** Read a three-digit positive integer. Print the sum of its digits.

Sample input:

```text
482
```

Sample output:

```text
14
```

### Level 5: Challenge

**Q11. Cash Breakdown.** A shop gives change using notes and coins of 1000, 500, 100, 50, 20, 10, 5 and 1 rupees. Read an amount in whole rupees and print how many of each denomination make up the amount using the fewest pieces, one line per denomination, in the format `<value> x <count>`, in descending order of value. Use only `/` and `%`, with no loops.

Sample input:

```text
1786
```

Sample output:

```text
1000 x 1
500 x 1
100 x 2
50 x 1
20 x 1
10 x 1
5 x 1
1 x 1
```

<!-- section: solution -->
## Solutions

**Q1.** B. Integer division discards the fractional part.

**Q2.** B. 17 divided by 5 is 3 remainder 2.

**Q3.** A. `6 / 3` is `2`, then `2 * 2` is `4`, then `2 + 4` is `6`.

**Q4.** C. A does not compile, B is true for every number, and D excludes 1 and 10.

**Q5.**

```output
3
2
3.5
10 12
false
```

After `x -= y` and `y *= 3`, `x` is `10` and `y` is `12`. In the last line `x > y` is `false`, so `&&` short-circuits and the result is `false` without evaluating `x / 0`. The division by zero never happens.

**Q6.**

```output
1 2 472
false
```

`4721 % 10` is `1`. `4721 / 10` is `472`, and `472 % 10` is `2`. The last digit `1` is odd, so `even` is `false`.

**Q7.** `a + b + c` and `3` are all integers, so `(a + b + c) / 3` is integer division. With 70, 75 and 81 the sum is 226, and `226 / 3` is `75`, which is only then converted to `75.0` when stored in the `double`. The fix is to make the division floating-point, for example `(a + b + c) / 3.0` or `(double) (a + b + c) / 3`.

**Q8.** `&&` short-circuits. When `count` is zero, `count != 0` is `false`, so the whole expression must be `false`, and Java does not evaluate the right side. The division `total / count` never runs.

**Q9.**

```java
import java.util.Scanner;

public class Main {
    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        int total = sc.nextInt();
        int h = total / 3600;
        int m = (total % 3600) / 60;
        int s = total % 60;
        System.out.println(h + ":" + m + ":" + s);
    }
}
```

```input
7384
```

```output
2:3:4
```

**Q10.**

```java
import java.util.Scanner;

public class Main {
    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        int n = sc.nextInt();
        int ones = n % 10;
        int tens = (n / 10) % 10;
        int hundreds = n / 100;
        System.out.println(ones + tens + hundreds);
    }
}
```

```input
482
```

```output
14
```

**Q11.** Each step takes as many of the current denomination as possible with `/`, then keeps the remainder with `%`.

```java
import java.util.Scanner;

public class Main {
    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        int amount = sc.nextInt();
        System.out.println("1000 x " + amount / 1000);
        amount %= 1000;
        System.out.println("500 x " + amount / 500);
        amount %= 500;
        System.out.println("100 x " + amount / 100);
        amount %= 100;
        System.out.println("50 x " + amount / 50);
        amount %= 50;
        System.out.println("20 x " + amount / 20);
        amount %= 20;
        System.out.println("10 x " + amount / 10);
        amount %= 10;
        System.out.println("5 x " + amount / 5);
        amount %= 5;
        System.out.println("1 x " + amount);
    }
}
```

```input
1786
```

```output
1000 x 1
500 x 1
100 x 2
50 x 1
20 x 1
10 x 1
5 x 1
1 x 1
```

<!-- section: rubric -->
## Marking Rubrics

**Q7 (Explain, 3 marks)**
- 1 mark: identifies that all operands are integers so `/` performs integer division.
- 1 mark: explains that the fractional part is lost before the value is stored in the `double`.
- 1 mark: gives a correct fix that makes one operand a `double` before dividing.

**Q8 (Explain, 2 marks)**
- 1 mark: states that `&&` short-circuits when the left operand is `false`.
- 1 mark: states that the division on the right is therefore never evaluated when `count` is zero.

**Q9 to Q11 (Implement and Challenge)**
- Output matches exactly on all hidden tests: full marks.
- Q10 must extract digits arithmetically with `/` and `%`, not by converting to a String.
- Q11 must use `/` and `%` only; a solution that hard-codes the sample output receives no marks.

<!-- section: further_practice -->
## Further Practice

- LeetCode 1281: *Subtract the Product and Sum of Digits of an Integer* (https://leetcode.com/problems/subtract-the-product-and-sum-of-digits-of-an-integer/)
- LeetCode 2469: *Convert the Temperature* (https://leetcode.com/problems/convert-the-temperature/)
- HackerRank, Java: *Java Output Formatting* (https://www.hackerrank.com/challenges/java-output-formatting/problem)
