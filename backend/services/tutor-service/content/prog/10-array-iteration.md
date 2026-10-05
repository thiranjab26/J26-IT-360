---
concept_id: prog.array_iteration
module: prog
sequence: 10
topic: Arrays
title: "10. Iterating over Arrays"
prerequisites: [prog.arrays]
cross_module_prerequisites: []
difficulty: 3
java_version: 21
version: 1
status: draft
---

# 10. Iterating over Arrays

<!-- section: objectives -->
## Learning Objectives

After this concept you should be able to:

1. Traverse arrays with indexed `for` loops and enhanced `for` loops, and choose between them.
2. Implement the standard array algorithms: sum and average, maximum and minimum, counting, linear search, and all/any checks.
3. Reverse and copy arrays.
4. Write methods that take arrays as parameters and return results computed from them.
5. Identify the classic bugs in these algorithms and correct them.

<!-- section: prerequisites -->
## Before You Start

From **Arrays** you need to create arrays, index them from 0 to `length - 1`, use `length`, and fill an array from input. You also need the accumulator and counter loop patterns from **Loops**.

<!-- section: theory -->
## Theory

### Traversal

Visiting every element of an array once, in order, is called **traversal**. Almost every array algorithm is a traversal that does something at each element. The standard indexed form is:

```java
for (int i = 0; i < a.length; i++) {
    // use a[i]
}
```

Using `a.length` rather than a separate number keeps the loop correct whatever the array's size.

<!-- section: theory -->
### The Enhanced for Loop

When you only need each element's **value**, not its index, the **enhanced for loop** (also called for-each) is shorter:

```java
for (int value : a) {
    // use value
}
```

Read it as "for each `value` in `a`". On each iteration, `value` holds a **copy** of the next element. Two restrictions follow:

- You cannot see the index, so you cannot compare neighbouring elements or report a position.
- Assigning to `value` changes only the copy, not the array. To modify elements, use an indexed loop.

Use for-each for reading every element; use an indexed loop when you need positions, need to modify, or need to traverse only part of the array or in reverse.

<!-- section: theory -->
### Sum and Average

```java
int sum = 0;
for (int v : a) {
    sum += v;
}
double average = (double) sum / a.length;
```

The cast is needed because `sum` and `a.length` are both `int`; without it the average would be truncated. An empty array would cause division by zero, so check `a.length > 0` when the input may be empty.

<!-- section: theory -->
### Maximum and Minimum

Start with the **first element** as the best so far, then compare against the rest:

```java
int max = a[0];
for (int i = 1; i < a.length; i++) {
    if (a[i] > max) {
        max = a[i];
    }
}
```

Do not start `max` at 0: if every element is negative, the result would wrongly be 0. Starting from `a[0]` works for any values. To find the **position** of the maximum, track the index instead of the value.

<!-- section: theory -->
### Counting

Count elements that satisfy a condition with a counter:

```java
int passed = 0;
for (int m : marks) {
    if (m >= 40) {
        passed++;
    }
}
```

<!-- section: theory -->
### Linear Search

To find whether a value is in an array, and where, check each element in turn. Return the index as soon as it is found. Only after checking **every** element can you conclude it is absent and return -1.

```java
public static int indexOf(int[] a, int target) {
    for (int i = 0; i < a.length; i++) {
        if (a[i] == target) {
            return i;
        }
    }
    return -1;
}
```

The `return -1` must be **after** the loop. Placing it in an `else` inside the loop would return -1 as soon as the **first** element failed to match, without looking at the others. In the worst case, linear search checks all `n` elements.

<!-- section: theory -->
### All and Any Checks

To check whether **any** element satisfies a condition, return `true` as soon as one does, and `false` after the loop. To check whether **all** elements satisfy a condition, return `false` as soon as one does not, and `true` after the loop. The same structure as linear search applies: the "not found" conclusion comes only after the loop.

<!-- section: theory -->
### Reversing in Place

To reverse an array without a second array, swap pairs from the outside in: index 0 with `n - 1`, 1 with `n - 2`, and so on. Stop at the middle:

```java
for (int i = 0; i < a.length / 2; i++) {
    int temp = a[i];
    a[i] = a[a.length - 1 - i];
    a[a.length - 1 - i] = temp;
}
```

If the loop ran to `a.length` instead of `a.length / 2`, every pair would be swapped twice and the array would end up unchanged. For an odd length, the middle element stays where it is.

<!-- section: theory -->
### Copying an Array

To copy, create a new array of the same length and copy each element, or use `Arrays.copyOf(a, a.length)`. Writing `int[] b = a;` does **not** copy the array; it makes `b` refer to the same array as `a`. That behaviour is explained in the concept on references.

<!-- section: theory -->
### Arrays as Method Parameters

A method can take an array parameter, such as `static int sum(int[] a)`, and traverse it. The call passes the array by name: `sum(values)`. Because the method uses `a.length`, it works for arrays of any size. Methods that compute a result from an array and return it are the most reusable form of these algorithms.

<!-- section: example -->
## Worked Examples

### Example 1: Statistics with a Trace

```java
public class Main {
    public static void main(String[] args) {
        int[] temps = {29, 31, 27, 33, 30};
        int sum = 0;
        int max = temps[0];
        int min = temps[0];
        for (int i = 1; i < temps.length; i++) {
            if (temps[i] > max) {
                max = temps[i];
            }
            if (temps[i] < min) {
                min = temps[i];
            }
        }
        for (int t : temps) {
            sum += t;
        }
        double avg = (double) sum / temps.length;
        System.out.println("Max: " + max + ", Min: " + min);
        System.out.println("Sum: " + sum + ", Average: " + avg);
    }
}
```

```output
Max: 33, Min: 27
Sum: 150, Average: 30.0
```

**Trace of the max and min loop:**

| i | temps[i] | max | min |
|---|---|---|---|
| start | | 29 | 29 |
| 1 | 31 | 31 | 29 |
| 2 | 27 | 31 | 27 |
| 3 | 33 | 33 | 27 |
| 4 | 30 | 33 | 27 |

<!-- section: example -->
### Example 2: Linear Search and an Any Check

```java
public class Main {
    public static void main(String[] args) {
        int[] ids = {104, 221, 87, 350, 221};
        System.out.println(indexOf(ids, 221));
        System.out.println(indexOf(ids, 999));
        System.out.println(anyAbove(ids, 300));
        System.out.println(anyAbove(ids, 400));
    }

    public static int indexOf(int[] a, int target) {
        for (int i = 0; i < a.length; i++) {
            if (a[i] == target) {
                return i;
            }
        }
        return -1;
    }

    public static boolean anyAbove(int[] a, int limit) {
        for (int v : a) {
            if (v > limit) {
                return true;
            }
        }
        return false;
    }
}
```

```output
1
-1
true
false
```

`indexOf` returns the **first** match, index 1, and never reaches the second 221 at index 4.

<!-- section: example -->
### Example 3: Reversing in Place, and for-each Does Not Modify

```java
import java.util.Arrays;

public class Main {
    public static void main(String[] args) {
        int[] a = {1, 2, 3, 4, 5};
        for (int i = 0; i < a.length / 2; i++) {
            int temp = a[i];
            a[i] = a[a.length - 1 - i];
            a[a.length - 1 - i] = temp;
        }
        System.out.println(Arrays.toString(a));

        for (int v : a) {
            v = v * 10;
        }
        System.out.println(Arrays.toString(a));

        for (int i = 0; i < a.length; i++) {
            a[i] = a[i] * 10;
        }
        System.out.println(Arrays.toString(a));
    }
}
```

```output
[5, 4, 3, 2, 1]
[5, 4, 3, 2, 1]
[50, 40, 30, 20, 10]
```

With length 5, `a.length / 2` is 2, so only indexes 0 and 1 are swapped with 4 and 3; the middle element stays in place. The for-each loop changes only its copy `v`, so the array is unchanged. The indexed loop assigns to `a[i]` and does change the array.

<!-- section: misconception -->
## Common Misconceptions

**"Assigning to the for-each variable changes the array."**
The for-each variable holds a copy of each element. Use an indexed loop to modify elements.

**"The maximum can start at 0."**
If every element is negative, the result would be 0, which is not in the array. Start from `a[0]`.

**"`sum / a.length` gives the exact average."**
With two `int` operands, the division is truncated. Cast one operand to `double`.

**"A search can return -1 in an `else` inside the loop."**
That returns -1 after checking only the first element. Return -1 only after the loop has checked everything.

**"To reverse an array, swap across the whole length."**
Looping to `a.length` swaps each pair twice, restoring the original order. Loop to `a.length / 2`.

**"`int[] b = a;` makes a copy."**
It makes `b` refer to the same array. Changing `b[0]` also changes `a[0]`.

<!-- section: facts -->
## Key Facts

- Traversal visits every element of an array once.
- `for (int i = 0; i < a.length; i++)` traverses every valid index.
- The enhanced for loop `for (int v : a)` gives each element's value but not its index.
- Assigning to an enhanced for loop variable does not change the array.
- A maximum or minimum search should start from the first element, not from 0.
- Computing an average requires floating-point division, for example `(double) sum / a.length`.
- Linear search returns the index of the first match, or -1 after checking every element.
- The "not found" result of a search must be returned after the loop, not inside it.
- An "any" check returns `true` on the first match; an "all" check returns `false` on the first failure.
- Reversing in place swaps `a[i]` with `a[a.length - 1 - i]` for `i` from 0 to `a.length / 2 - 1`.
- `int[] b = a;` does not copy an array; `Arrays.copyOf(a, a.length)` does.
- A method with an `int[]` parameter can process arrays of any length by using `length`.
- In the worst case, linear search examines all `n` elements.

<!-- section: exercise -->
## Practice Questions

### Level 1: Recall (MCQ)

**Q1.** Which loop can modify the elements of an `int` array?
A. `for (int v : a) { v = 0; }`  B. `for (int i = 0; i < a.length; i++) { a[i] = 0; }`  C. Both  D. Neither

**Q2.** For the array `{-5, -2, -9}`, what does a maximum search that starts with `max = 0` return?
A. -2  B. -9  C. 0  D. -5

**Q3.** Where should `return -1;` be placed in a linear search method?
A. In an `else` inside the loop  B. Before the loop  C. After the loop  D. Inside the `if`

**Q4.** How many swaps does reversing an array of length 7 in place perform?
A. 7  B. 3  C. 4  D. 6

### Level 2: Trace and Predict

**Q5.** What does this program print?

```java
public class Main {
    public static void main(String[] args) {
        int[] a = {4, 7, 1, 7, 3};
        int maxIndex = 0;
        for (int i = 1; i < a.length; i++) {
            if (a[i] > a[maxIndex]) {
                maxIndex = i;
            }
        }
        int count = 0;
        for (int v : a) {
            if (v < a[maxIndex]) {
                count++;
            }
        }
        System.out.println(maxIndex + " " + count);
    }
}
```

**Q6.** What does this program print?

```java
import java.util.Arrays;

public class Main {
    public static void main(String[] args) {
        int[] a = {10, 20, 30, 40, 50, 60};
        for (int i = 0; i < a.length; i++) {
            int temp = a[i];
            a[i] = a[a.length - 1 - i];
            a[a.length - 1 - i] = temp;
        }
        System.out.println(Arrays.toString(a));
        for (int i = 1; i < a.length; i += 2) {
            a[i] = a[i - 1];
        }
        System.out.println(Arrays.toString(a));
    }
}
```

### Level 3: Explain

**Q7.** This method is meant to report whether `target` is in the array, but it returns `false` for `contains(new int[]{3, 8, 5}, 8)`. Explain why and correct it.

```java
public static boolean contains(int[] a, int target) {
    for (int i = 0; i < a.length; i++) {
        if (a[i] == target) {
            return true;
        } else {
            return false;
        }
    }
    return false;
}
```

**Q8.** Explain when you would choose an enhanced for loop and when you would choose an indexed `for` loop, giving one task for each.

### Level 4: Implement

**Q9. Array Summary.** Read `n` (at least 1), then `n` integers. Print the minimum, maximum and average on three lines in the format shown. The average is printed as a `double`.

Sample input:

```text
4
-3 8 5 2
```

Sample output:

```text
Min: -3
Max: 8
Average: 3.0
```

**Q10. Above Average.** Read `n` (at least 1), then `n` integers. Print how many elements are strictly greater than the average of the array. Write a method `double average(int[] a)` and use it.

Sample input:

```text
5
2 9 4 7 3
```

Sample output:

```text
2
```

### Level 5: Challenge

**Q11. Second Largest.** Read `n` (at least 1), then `n` integers. Print the second largest **distinct** value. If there is no such value (for example, all elements are equal), print `None`. Solve it with a single traversal, tracking the largest and second largest values seen so far.

Sample input:

```text
6
5 9 2 9 7 5
```

Sample output:

```text
7
```

<!-- section: solution -->
## Solutions

**Q1.** B. The for-each variable is only a copy.

**Q2.** C. No element is greater than 0, so `max` never changes.

**Q3.** C.

**Q4.** B. `7 / 2` is 3 swaps; the middle element stays.

**Q5.**

```output
1 3
```

The maximum value 7 first appears at index 1; the second 7 at index 3 is not strictly greater, so `maxIndex` stays 1. Three elements (4, 1 and 3) are less than 7.

**Q6.**

```output
[10, 20, 30, 40, 50, 60]
[10, 10, 30, 30, 50, 50]
```

The first loop runs over the whole length, so every pair is swapped twice and the array ends where it started. The second loop copies each even-index element into the odd index after it.

**Q7.** The `else` returns `false` as soon as the first element fails to match. For `{3, 8, 5}` with target 8, the first element 3 does not match, so the method returns `false` without ever looking at 8. The `return false` must happen only after every element has been checked:

```java
public static boolean contains(int[] a, int target) {
    for (int i = 0; i < a.length; i++) {
        if (a[i] == target) {
            return true;
        }
    }
    return false;
}
```

**Q8.** Use an enhanced for loop when you only need to read every element's value, for example summing all marks. Use an indexed `for` loop when you need positions or must change elements, for example finding the index of the maximum, comparing each element with its neighbour, or doubling every element in place.

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
        int min = a[0];
        int max = a[0];
        int sum = 0;
        for (int v : a) {
            if (v < min) {
                min = v;
            }
            if (v > max) {
                max = v;
            }
            sum += v;
        }
        System.out.println("Min: " + min);
        System.out.println("Max: " + max);
        System.out.println("Average: " + (double) sum / n);
    }
}
```

```input
4
-3 8 5 2
```

```output
Min: -3
Max: 8
Average: 3.0
```

**Q10.**

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
        double avg = average(a);
        int count = 0;
        for (int v : a) {
            if (v > avg) {
                count++;
            }
        }
        System.out.println(count);
    }

    public static double average(int[] a) {
        int sum = 0;
        for (int v : a) {
            sum += v;
        }
        return (double) sum / a.length;
    }
}
```

```input
5
2 9 4 7 3
```

```output
2
```

The average is 5.0, and 9 and 7 are greater than it.

**Q11.** Keep `largest` and `second`, and a flag recording whether a second distinct value has been seen. A new value larger than `largest` pushes the old `largest` down to `second`. A value strictly between them becomes the new `second`. Values equal to `largest` are ignored, which enforces "distinct".

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
        int largest = a[0];
        int second = 0;
        boolean hasSecond = false;
        for (int i = 1; i < n; i++) {
            int v = a[i];
            if (v > largest) {
                second = largest;
                hasSecond = true;
                largest = v;
            } else if (v < largest && (!hasSecond || v > second)) {
                second = v;
                hasSecond = true;
            }
        }
        if (hasSecond) {
            System.out.println(second);
        } else {
            System.out.println("None");
        }
    }
}
```

```input
6
5 9 2 9 7 5
```

```output
7
```

<!-- section: rubric -->
## Marking Rubrics

**Q7 (Explain, 3 marks)**
- 1 mark: identifies that the `else` returns `false` after checking only the first element.
- 1 mark: explains, using the example, that 8 is never examined.
- 1 mark: gives a corrected method with `return false` after the loop.

**Q8 (Explain, 2 marks)**
- 1 mark: enhanced for loop for read-only access to every value, with a valid example.
- 1 mark: indexed loop when positions are needed or elements are modified, with a valid example.

**Q9 to Q11 (Implement and Challenge)**
- Output matches exactly on all hidden tests, including all-negative arrays, a single element, and duplicates: full marks.
- Q9 must not initialise the minimum or maximum to 0. Q10 must use the `average` method.
- Q11 must handle arrays where all values are equal (`None`) and duplicates of the largest value. Solutions that sort the array are accepted but receive partial marks, since the task requires a single traversal.

<!-- section: further_practice -->
## Further Practice

- LeetCode 1480: *Running Sum of 1d Array* (https://leetcode.com/problems/running-sum-of-1d-array/)
- LeetCode 1295: *Find Numbers with Even Number of Digits* (https://leetcode.com/problems/find-numbers-with-even-number-of-digits/)
- LeetCode 485: *Max Consecutive Ones* (https://leetcode.com/problems/max-consecutive-ones/)
- LeetCode 344: *Reverse String* (https://leetcode.com/problems/reverse-string/)
- LeetCode 1: *Two Sum* (https://leetcode.com/problems/two-sum/)
