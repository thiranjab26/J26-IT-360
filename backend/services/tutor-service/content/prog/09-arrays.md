---
concept_id: prog.arrays
module: prog
sequence: 9
topic: Arrays
title: "9. Arrays"
prerequisites: [prog.variables_types, prog.loops]
cross_module_prerequisites: []
difficulty: 2
java_version: 21
version: 1
status: draft
---

# 9. Arrays

<!-- section: objectives -->
## Learning Objectives

After this concept you should be able to:

1. Declare and create arrays, with a size or with an initialiser list.
2. Read and update elements using zero-based indexes, and use `length`.
3. State the default values of a newly created array.
4. Recognise and avoid `ArrayIndexOutOfBoundsException`.
5. Read a sequence of input values into an array and print an array's contents.

<!-- section: prerequisites -->
## Before You Start

From **Variables and Data Types** you need primitive types and `String`. From **Loops** you need `for` loops, especially `for (int i = 0; i < n; i++)`, which runs exactly `n` times with `i` from 0 to `n - 1`.

<!-- section: theory -->
## Theory

### Why Arrays

Storing the marks of 40 students in 40 separate variables (`mark1`, `mark2`, ...) is impractical: you cannot loop over variable names. An **array** is a single variable that holds a fixed number of values of the **same type**, stored one after another. Each value is an **element**, and each element is identified by its position, called its **index**.

<!-- section: theory -->
### Declaring and Creating Arrays

```java
int[] marks;              // declares a variable that can refer to an int array
marks = new int[5];       // creates an array of 5 ints

double[] prices = new double[3];                 // declare and create in one step
int[] primes = {2, 3, 5, 7, 11};                 // initialiser list: size 5
String[] days = {"Mon", "Tue", "Wed"};           // arrays of Strings
```

The type `int[]` is read "int array". The keyword `new` creates the array with the size in square brackets. An **initialiser list** in braces creates the array and fills it in one step; its size is the number of values listed.

<!-- section: theory -->
### Indexing

Elements are numbered from **0**. An array of length `n` has indexes `0` to `n - 1`.

```java
int[] primes = {2, 3, 5, 7, 11};
// index:        0  1  2  3  4
int first = primes[0];      // 2
int last = primes[4];       // 11
primes[1] = 13;             // array is now {2, 13, 5, 7, 11}
```

An element such as `primes[2]` behaves exactly like a variable of the element type: it can be read, assigned, incremented and passed to methods. The index can be any `int` expression, such as `primes[i]` or `primes[i + 1]`.

<!-- section: theory -->
### length

Every array has a `length` field giving the number of elements it holds. It is written **without parentheses**: `primes.length`. (By contrast, `String` uses a method, `s.length()`.) The last valid index is always `array.length - 1`.

`length` is the **capacity** of the array, fixed when it was created. It does not count how many elements you have "filled in".

<!-- section: theory -->
### Fixed Size

Once created, an array's length cannot change. To store more elements, you must create a new, larger array and copy the elements across. Java's `ArrayList` class grows automatically, but this module uses plain arrays because they show exactly what happens in memory, which matters in the Data Structures and Algorithms module.

<!-- section: theory -->
### Default Values

A newly created array is filled with default values of its element type:

| Element type | Default |
|---|---|
| `int`, `long` | `0` |
| `double` | `0.0` |
| `boolean` | `false` |
| `char` | the character with code 0 |
| `String` and other objects | `null` |

This is different from local variables, which have no default value. `null` means "refers to no object"; it is covered in the concept on references.

<!-- section: theory -->
### Out-of-Bounds Access

Using an index below 0 or at or above `length` throws an **`ArrayIndexOutOfBoundsException`** at runtime, and the program stops. The compiler cannot catch this, because the index is usually only known while the program runs. The most common cause is an off-by-one loop condition such as `i <= array.length`, which tries to access `array[array.length]` on its final iteration.

<!-- section: theory -->
### Filling an Array from Input

When the first input value is the number of elements, create the array with that size and fill it with a loop:

```java
int n = sc.nextInt();
int[] values = new int[n];
for (int i = 0; i < n; i++) {
    values[i] = sc.nextInt();
}
```

The condition `i < n` (equivalently `i < values.length`) visits exactly the valid indexes.

<!-- section: theory -->
### Printing an Array

`System.out.println(values)` does not print the elements. It prints something like `[I@1b6d3586`: a type code and an identifier for the array object. To see the contents, loop over the elements, or use `Arrays.toString` from `java.util.Arrays`:

```java
import java.util.Arrays;
System.out.println(Arrays.toString(values));   // [4, 8, 15]
```

<!-- section: theory -->
### Arrays and Strings

A `String` is similar to an array of characters: `s.charAt(i)` is like indexing, with indexes from 0 to `s.length() - 1`. `s.toCharArray()` returns an actual `char[]` containing the String's characters. Unlike arrays, Strings cannot be changed element by element.

<!-- section: example -->
## Worked Examples

### Example 1: Creating, Reading and Updating

```java
import java.util.Arrays;

public class Main {
    public static void main(String[] args) {
        int[] scores = new int[4];
        System.out.println(Arrays.toString(scores));

        scores[0] = 70;
        scores[2] = 85;
        scores[3] = scores[0] + 5;
        scores[0]++;
        System.out.println(Arrays.toString(scores));

        System.out.println("Length: " + scores.length);
        System.out.println("Last: " + scores[scores.length - 1]);

        String[] names = new String[2];
        boolean[] flags = new boolean[2];
        System.out.println(names[0] + " " + flags[1]);
    }
}
```

```output
[0, 0, 0, 0]
[71, 0, 85, 75]
Length: 4
Last: 75
null false
```

**Trace of `scores`:**

| Statement | scores |
|---|---|
| `new int[4]` | [0, 0, 0, 0] |
| `scores[0] = 70` | [70, 0, 0, 0] |
| `scores[2] = 85` | [70, 0, 85, 0] |
| `scores[3] = scores[0] + 5` | [70, 0, 85, 75] |
| `scores[0]++` | [71, 0, 85, 75] |

<!-- section: example -->
### Example 2: Reading Values and Printing Them in Reverse

```java
import java.util.Scanner;

public class Main {
    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        int n = sc.nextInt();
        int[] values = new int[n];
        for (int i = 0; i < n; i++) {
            values[i] = sc.nextInt();
        }
        for (int i = n - 1; i >= 0; i--) {
            System.out.print(values[i]);
            if (i > 0) {
                System.out.print(" ");
            }
        }
        System.out.println();
    }
}
```

```input
5
4 8 15 16 23
```

```output
23 16 15 8 4
```

The first loop fills indexes 0 to 4. The second starts at the last valid index, `n - 1`, and counts down to 0.

<!-- section: example -->
### Example 3: Indexes Computed from Other Elements

```java
public class Main {
    public static void main(String[] args) {
        int[] a = {3, 0, 4, 1, 2};
        System.out.println(a[a[0]]);
        System.out.println(a[a[1]] + a[a.length - 1]);
        int i = 2;
        a[i + 1] = a[i] * 10;
        System.out.println(a[3]);
    }
}
```

```output
1
5
40
```

`a[0]` is 3, so `a[a[0]]` is `a[3]`, which is 1. `a[1]` is 0, so `a[a[1]]` is `a[0]`, which is 3, and `a[a.length - 1]` is `a[4]`, which is 2, giving 5. Finally `a[3]` becomes `a[2] * 10`, which is 40.

<!-- section: misconception -->
## Common Misconceptions

**"The first element is at index 1."**
Array indexes start at 0.

**"The last element is at index `length`."**
The last element is at `length - 1`. Index `length` is out of bounds.

**"`length` is a method, so it needs parentheses."**
For arrays, `length` is a field: `a.length`. For Strings it is a method: `s.length()`.

**"An array grows when you add more elements."**
An array's size is fixed when it is created.

**"A new array contains random leftover values."**
Java fills new arrays with default values: 0, 0.0, `false` or `null`.

**"`System.out.println(arr)` prints the elements."**
It prints a type code and identifier. Use a loop or `Arrays.toString(arr)`.

**"`length` tells you how many elements have been filled in."**
`length` is the capacity set at creation, regardless of which elements were assigned.

**"The compiler catches out-of-bounds indexes."**
Out-of-bounds access is detected only at runtime, as an `ArrayIndexOutOfBoundsException`.

<!-- section: facts -->
## Key Facts

- An array holds a fixed number of values of the same type.
- `new int[n]` creates an array of `n` ints.
- An initialiser list such as `{2, 3, 5}` creates and fills an array; its length is the number of values.
- Array indexes start at 0; the last index is `length - 1`.
- `array.length` gives the number of elements and is written without parentheses.
- An array's length cannot change after it is created.
- New `int` arrays are filled with 0, `double` arrays with 0.0, `boolean` arrays with `false`, and object arrays such as `String[]` with `null`.
- An element such as `a[i]` can be read and assigned like an ordinary variable.
- Accessing an index below 0 or at least `length` throws `ArrayIndexOutOfBoundsException` at runtime.
- The loop `for (int i = 0; i < a.length; i++)` visits every valid index exactly once.
- `System.out.println(array)` does not print the elements; `Arrays.toString(array)` does.
- `s.toCharArray()` converts a String into a `char[]`.

<!-- section: exercise -->
## Practice Questions

### Level 1: Recall (MCQ)

**Q1.** An array is created with `new double[6]`. What is its last valid index?
A. 6  B. 5  C. 7  D. 0

**Q2.** What does `new boolean[3]` contain immediately after creation?
A. `true, true, true`  B. Random values  C. `false, false, false`  D. `null, null, null`

**Q3.** Which expression gives the number of elements in the array `data`?
A. `data.length()`  B. `data.size()`  C. `data.length`  D. `length(data)`

**Q4.** What happens when the program executes `int[] a = {1, 2, 3}; a[3] = 4;`?
A. The array grows to length 4  B. A compile-time error  C. `ArrayIndexOutOfBoundsException` at runtime  D. The value is ignored

### Level 2: Trace and Predict

**Q5.** What does this program print?

```java
public class Main {
    public static void main(String[] args) {
        int[] x = new int[5];
        for (int i = 0; i < x.length; i++) {
            x[i] = i * i;
        }
        x[4] = x[2] + x[3];
        System.out.println(x[1] + " " + x[4] + " " + x.length);
    }
}
```

**Q6.** What does this program print?

```java
public class Main {
    public static void main(String[] args) {
        String[] words = {"red", "green", "blue"};
        char[] letters = words[1].toCharArray();
        letters[0] = 'G';
        System.out.println(letters.length);
        System.out.println(letters[0] + "" + letters[letters.length - 1]);
        System.out.println(words[1]);
        System.out.println(words[2].charAt(words.length - 1));
    }
}
```

### Level 3: Explain

**Q7.** This loop is meant to print every element of `arr`, but the program crashes after printing them all. Explain the error message the student sees and why, then fix the loop.

```java
for (int i = 0; i <= arr.length; i++) {
    System.out.println(arr[i]);
}
```

**Q8.** Explain why arrays are useful compared with separate variables, and state one limitation of Java arrays.

### Level 4: Implement

**Q9. Element Lookup.** Read `n`, then `n` integers into an array, then a query index `q`. If `q` is a valid index, print the element at `q`; otherwise print `Out of range`.

Sample input:

```text
4
10 20 30 40
2
```

Sample output:

```text
30
```

**Q10. First and Last Swap.** Read `n` (at least 1), then `n` integers into an array. Swap the first and last elements, then print the array using `Arrays.toString`.

Sample input:

```text
5
1 2 3 4 5
```

Sample output:

```text
[5, 2, 3, 4, 1]
```

### Level 5: Challenge

**Q11. Digit Frequency.** Read a single line containing only digits (it may be very long, so read it as a String). Use an `int[10]` array as a set of counters, where `count[d]` holds how many times digit `d` appears. Print each digit that appears at least once, with its count, in increasing digit order, in the format `<digit>: <count>`.

Sample input:

```text
2026091503
```

Sample output:

```text
0: 3
1: 1
2: 2
3: 1
5: 1
6: 1
9: 1
```

<!-- section: solution -->
## Solutions

**Q1.** B.

**Q2.** C.

**Q3.** C.

**Q4.** C. The array has indexes 0 to 2, and its size is fixed.

**Q5.**

```output
1 13 5
```

The loop fills `x` with 0, 1, 4, 9, 16. Then `x[4]` becomes `4 + 9`, which is 13.

**Q6.**

```output
5
Gn
green
u
```

`"green".toCharArray()` creates a new `char[]` of length 5. Changing `letters[0]` does not change the String in `words[1]`, which is still `"green"`. In `letters[0] + "" + letters[4]`, the empty String forces text concatenation of `'G'` and `'n'`; without it, Java would add the two character codes as numbers. Finally, `words.length - 1` is 2, and the character at index 2 of `"blue"` is `'u'`.

**Q7.** The condition `i <= arr.length` lets `i` reach `arr.length`. On that final iteration the loop tries to read `arr[arr.length]`, one past the last valid index, so Java throws `ArrayIndexOutOfBoundsException` after all real elements have already been printed. The fix is `i < arr.length`.

**Q8.** An array stores many values of the same type under one name, and elements are selected by an index that can be computed, so a loop can process every element with a few lines of code. With separate variables, each one must be named and handled individually. One limitation is that an array's length is fixed at creation; another is that all elements must have the same type.

**Q9.**

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
        int q = sc.nextInt();
        if (q >= 0 && q < a.length) {
            System.out.println(a[q]);
        } else {
            System.out.println("Out of range");
        }
    }
}
```

```input
4
10 20 30 40
2
```

```output
30
```

**Q10.**

```java
import java.util.Arrays;
import java.util.Scanner;

public class Main {
    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        int n = sc.nextInt();
        int[] a = new int[n];
        for (int i = 0; i < n; i++) {
            a[i] = sc.nextInt();
        }
        int temp = a[0];
        a[0] = a[n - 1];
        a[n - 1] = temp;
        System.out.println(Arrays.toString(a));
    }
}
```

```input
5
1 2 3 4 5
```

```output
[5, 2, 3, 4, 1]
```

**Q11.** The value of each digit character is used as an index: `c - '0'` converts the character `'7'` into the number 7, because digit characters have consecutive codes.

```java
import java.util.Scanner;

public class Main {
    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        String digits = sc.next();
        int[] count = new int[10];
        for (int i = 0; i < digits.length(); i++) {
            int d = digits.charAt(i) - '0';
            count[d]++;
        }
        for (int d = 0; d < 10; d++) {
            if (count[d] > 0) {
                System.out.println(d + ": " + count[d]);
            }
        }
    }
}
```

```input
2026091503
```

```output
0: 3
1: 1
2: 2
3: 1
5: 1
6: 1
9: 1
```

<!-- section: rubric -->
## Marking Rubrics

**Q7 (Explain, 3 marks)**
- 1 mark: names `ArrayIndexOutOfBoundsException`.
- 1 mark: explains that `<=` lets `i` reach `arr.length`, which is one past the last valid index.
- 1 mark: gives the fix `i < arr.length`.

**Q8 (Explain, 2 marks)**
- 1 mark: explains that one array with computed indexes lets a loop process many values.
- 1 mark: states a valid limitation, such as fixed length or a single element type.

**Q9 to Q11 (Implement and Challenge)**
- Output matches exactly on all hidden tests, including invalid query indexes such as -1 and `n` for Q9, and `n = 1` for Q10: full marks.
- Q11 must use an array of counters indexed by digit value; ten separate counter variables receive partial marks.

<!-- section: further_practice -->
## Further Practice

- HackerRank, Java: *Java 1D Array* (https://www.hackerrank.com/challenges/java-1d-array-introduction/problem)
- LeetCode 1929: *Concatenation of Array* (https://leetcode.com/problems/concatenation-of-array/)
- LeetCode 1920: *Build Array from Permutation* (https://leetcode.com/problems/build-array-from-permutation/)
- LeetCode 1470: *Shuffle the Array* (https://leetcode.com/problems/shuffle-the-array/)
