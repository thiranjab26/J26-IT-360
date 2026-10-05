---
concept_id: prog.references
module: prog
sequence: 12
topic: Objects
title: "12. References"
prerequisites: [prog.classes_objects, prog.arrays]
cross_module_prerequisites: []
difficulty: 3
java_version: 21
version: 1
status: draft
---

# 12. References

<!-- section: objectives -->
## Learning Objectives

After this concept you should be able to:

1. Explain the difference between a primitive variable and a reference variable.
2. Predict the effects of aliasing when two variables refer to the same object or array.
3. Explain what `null` means and why it causes `NullPointerException`.
4. Predict what a method can and cannot change when it receives an object or array.
5. Distinguish `==` from `equals`, and follow chains of objects that refer to other objects.

<!-- section: prerequisites -->
## Before You Start

From **Classes and Objects** you need to create objects with `new` and use their fields and methods. From **Arrays** you need to create and index arrays. From **Methods** you need the rule that Java passes arguments by value.

<!-- section: theory -->
## Theory

### Two Kinds of Variable

Java has two kinds of variable.

- A **primitive variable** (`int`, `double`, `char`, `boolean` and so on) holds its **value directly**.
- A **reference variable** (any class type, such as `String`, `Student` or `Scanner`, and every array type) holds a **reference**: the location of an object in memory. The object itself lives separately.

```java
int count = 5;                      // count holds 5
Student s = new Student("Amal", 72);  // s holds a reference to a Student object
```

It helps to draw references as arrows. `count` is a box containing 5. `s` is a box containing an arrow that points to a separate `Student` object with its own `name` and `mark` boxes.

`new` creates an object and **returns a reference** to it, which is what gets stored in the variable.

<!-- section: theory -->
### Assignment Copies the Reference, Not the Object

Assigning a primitive copies the value, so the two variables are independent afterwards. Assigning a reference copies the **arrow**, so both variables point to the **same** object:

```java
int a = 5;
int b = a;       // b gets its own 5
b = 9;           // a is still 5

Student s1 = new Student("Amal", 72);
Student s2 = s1;       // s2 points to the same object as s1
s2.mark = 90;          // changes that one object
System.out.println(s1.mark);   // 90
```

Two references to the same object are called **aliases**. A change made through either one is visible through the other, because there is only one object. No copy was made; `s2 = s1` created no new `Student`.

Arrays behave identically, because arrays are objects: after `int[] y = x;`, writing `y[0] = 99` also changes `x[0]`.

<!-- section: theory -->
### null

A reference variable can hold the special value **`null`**, meaning it currently refers to **no object**. Fields of class type and elements of object arrays start as `null` by default.

Using `null` as if it were an object, by reading a field or calling a method through it, throws a **`NullPointerException`** at runtime:

```java
Student s = null;
System.out.println(s.name);   // NullPointerException
```

Always check `if (s != null)` before using a reference that might be `null`. Note that `null` is not the same as an empty String `""` or the number 0: an empty String is a real object with length 0.

<!-- section: theory -->
### Passing References to Methods

Java **always** passes arguments by value. For a reference variable, the value that is copied is the **reference**. The parameter therefore points to the **same object** as the caller's variable. This has two consequences:

1. **Changing the object's contents through the parameter is visible to the caller**, because both point to the same object. A method that sets `a[i] = 0` or `s.mark = 50` changes the caller's array or object.
2. **Reassigning the parameter itself has no effect on the caller.** `s = new Student(...)` inside the method points only the parameter's copy of the arrow at a new object. The caller's variable still points to the original.

This is why a method can fill or sort an array passed to it, but cannot make the caller's variable refer to a different array.

<!-- section: theory -->
### == Versus equals

For references, `==` checks whether two variables point to the **same object**, known as identity. It does not compare contents.

`equals` compares **contents**, as defined by the class. `String.equals` compares characters, which is why Strings must be compared with `equals`:

```java
String a = new String("java");
String b = new String("java");
System.out.println(a == b);        // false: two different objects
System.out.println(a.equals(b));   // true: same characters
```

String literals written directly in code, like `"java"`, are sometimes shared by the JVM, so `==` can appear to work for them. That behaviour is an implementation detail and must not be relied on. Use `equals` for Strings, always.

<!-- section: theory -->
### Strings Are Immutable

A `String` object can never be changed after it is created. Methods such as `toUpperCase()` or `concat()` return a **new** String and leave the original untouched. `s = s.toUpperCase();` works because it points `s` at the new String. Calling `s.toUpperCase();` without assigning the result changes nothing.

<!-- section: theory -->
### Objects That Refer to Objects

A field can itself be a reference to another object, including an object of the **same class**:

```java
class Carriage {
    int passengers;
    Carriage next;      // reference to the following carriage, or null
}
```

Linking objects this way builds a **chain**: the first carriage points to the second, which points to the third, and the last carriage's `next` is `null`. To visit every object in the chain, follow the references with a variable that moves along it until it reaches `null`:

```java
Carriage current = first;
while (current != null) {
    // use current
    current = current.next;
}
```

This pattern is the foundation of the **linked list** in the Data Structures and Algorithms module.

<!-- section: theory -->
### Garbage Collection

When no reference points to an object any more, the program can no longer reach it. Java's **garbage collector** detects such unreachable objects and frees their memory automatically. You never delete objects yourself in Java; you simply stop referring to them.

<!-- section: example -->
## Worked Examples

### Example 1: Aliasing with Arrays and Objects

```java
import java.util.Arrays;

public class Main {
    public static void main(String[] args) {
        int[] x = {1, 2, 3};
        int[] y = x;
        int[] z = Arrays.copyOf(x, x.length);
        y[0] = 99;
        System.out.println(Arrays.toString(x));
        System.out.println(Arrays.toString(z));
        System.out.println((x == y) + " " + (x == z));

        Box b1 = new Box(5);
        Box b2 = b1;
        b2.value = 8;
        b1 = new Box(1);
        System.out.println(b1.value + " " + b2.value);
    }
}

class Box {
    int value;

    Box(int value) {
        this.value = value;
    }
}
```

```output
[99, 2, 3]
[1, 2, 3]
true false
1 8
```

`y` is an alias of `x`, so changing `y[0]` changes the one shared array. `z` is a genuine copy. For the boxes: `b2` becomes an alias of the first box and sets its value to 8. Then `b1` is pointed at a brand-new box, which does not affect `b2`: it still points to the first box, whose value is 8.

<!-- section: example -->
### Example 2: What a Method Can and Cannot Change

```java
import java.util.Arrays;

public class Main {
    public static void main(String[] args) {
        int[] data = {4, 5, 6};
        zeroFirst(data);
        System.out.println(Arrays.toString(data));
        replace(data);
        System.out.println(Arrays.toString(data));

        Box box = new Box(10);
        addTen(box);
        System.out.println(box.value);
    }

    public static void zeroFirst(int[] a) {
        a[0] = 0;
    }

    public static void replace(int[] a) {
        a = new int[]{7, 7, 7};
        a[1] = 100;
    }

    public static void addTen(Box b) {
        b.value += 10;
    }
}

class Box {
    int value;

    Box(int value) {
        this.value = value;
    }
}
```

```output
[0, 5, 6]
[0, 5, 6]
20
```

`zeroFirst` and `addTen` change the **contents** of the object their parameter points to, which the caller sees. `replace` points its parameter at a **new** array; the caller's `data` still points to the original, so nothing the method does afterwards is visible.

<!-- section: example -->
### Example 3: Following a Chain of References

```java
public class Main {
    public static void main(String[] args) {
        Carriage c3 = new Carriage(40, null);
        Carriage c2 = new Carriage(25, c3);
        Carriage c1 = new Carriage(30, c2);

        int total = 0;
        int count = 0;
        Carriage current = c1;
        while (current != null) {
            total += current.passengers;
            count++;
            current = current.next;
        }
        System.out.println(count + " carriages, " + total + " passengers");
        System.out.println(c1.next.next.passengers);
    }
}

class Carriage {
    int passengers;
    Carriage next;

    Carriage(int passengers, Carriage next) {
        this.passengers = passengers;
        this.next = next;
    }
}
```

```output
3 carriages, 95 passengers
40
```

**Trace of `current`:**

| Iteration | current points to | passengers | total after |
|---|---|---|---|
| 1 | c1 | 30 | 30 |
| 2 | c2 | 25 | 55 |
| 3 | c3 | 40 | 95 |
| end | `null` | | 95 |

`c1.next.next` follows two references: from `c1` to `c2`, then from `c2` to `c3`.

<!-- section: misconception -->
## Common Misconceptions

**"`b = a` copies the object."**
For references, assignment copies only the reference. Both variables then point to the same object.

**"Java passes objects by reference."**
Java passes everything by value. For objects, the value copied is the reference. That is why a method can change an object's contents but cannot make the caller's variable point to a different object.

**"Reassigning a parameter changes the caller's variable."**
Reassigning a parameter only redirects the method's own copy of the reference.

**"`==` compares the contents of two Strings or objects."**
`==` checks whether two references point to the same object. Use `equals` to compare contents.

**"`null` is the same as an empty String or zero."**
`null` means no object. An empty String is an object; calling `length()` on it returns 0, while calling `length()` on `null` throws `NullPointerException`.

**"`s.toUpperCase();` changes `s`."**
Strings are immutable. The method returns a new String, which must be assigned.

**"Objects must be deleted manually."**
The garbage collector frees objects that are no longer reachable.

<!-- section: facts -->
## Key Facts

- A primitive variable holds its value directly.
- A reference variable holds a reference to an object stored elsewhere in memory.
- All class types and all array types are reference types.
- `new` creates an object and returns a reference to it.
- Assigning one reference variable to another copies the reference, not the object.
- Two references to the same object are aliases; a change through one is visible through the other.
- `null` means a reference points to no object.
- Accessing a field or calling a method through `null` throws `NullPointerException`.
- Java passes arguments by value; for objects and arrays, the value passed is a reference.
- A method can change the contents of an object or array passed to it, and the caller sees the change.
- Reassigning a parameter inside a method does not change the caller's variable.
- For references, `==` tests whether two references point to the same object.
- `equals` compares contents; Strings must be compared with `equals`.
- Strings are immutable; String methods return new Strings.
- A field can refer to another object of the same class, forming a chain.
- A chain is traversed by following references until `null`.
- Objects that are no longer reachable are freed automatically by the garbage collector.

<!-- section: exercise -->
## Practice Questions

### Level 1: Recall (MCQ)

**Q1.** After `int[] p = {1, 2}; int[] q = p; q[1] = 5;`, what is `p[1]`?
A. 2  B. 5  C. 0  D. A compile-time error

**Q2.** What does `a == b` test when `a` and `b` are `String` variables?
A. Whether they contain the same characters  B. Whether they refer to the same object  C. Whether they have the same length  D. Whether both are non-null

**Q3.** What happens when a method runs `param = new Student("X", 0);` on its parameter?
A. The caller's variable now refers to the new student  B. Only the method's parameter refers to the new student  C. A compile-time error  D. The original object is deleted

**Q4.** Which statement throws `NullPointerException` when `s` is `null`?
A. `if (s == null) {}`  B. `Student t = s;`  C. `System.out.println(s.name);`  D. `s = new Student("A", 1);`

### Level 2: Trace and Predict

**Q5.** What does this program print?

```java
public class Main {
    public static void main(String[] args) {
        int[] a = {1, 2, 3};
        int[] b = a;
        int[] c = {1, 2, 3};
        b[2] = 30;
        a = new int[]{9, 9, 9};
        System.out.println(b[2] + " " + a[2] + " " + c[2]);
        System.out.println((b == c) + " " + (a == b));
    }
}
```

**Q6.** What does this program print?

```java
public class Main {
    public static void main(String[] args) {
        Account acc = new Account(100);
        update(acc);
        System.out.println(acc.balance);
        String s = "hello";
        shout(s);
        System.out.println(s);
        s = s.toUpperCase();
        System.out.println(s);
    }

    public static void update(Account a) {
        a.balance += 50;
        a = new Account(0);
        a.balance += 500;
    }

    public static void shout(String text) {
        text = text.toUpperCase();
    }
}

class Account {
    int balance;

    Account(int balance) {
        this.balance = balance;
    }
}
```

### Level 3: Explain

**Q7.** Two `String` variables both hold the text `"SLIIT"`, yet `first == second` is `false`. Explain how this can happen, and state the correct way to compare them.

**Q8.** Explain why a method can set every element of an array passed to it to zero, but cannot make the caller's array variable refer to a different, longer array.

### Level 4: Implement

**Q9. Double in Place.** Write `void doubleAll(int[] a)`, which doubles every element of the array it receives and returns nothing. In `main`, read `n` and then `n` integers, call `doubleAll`, and print the array with `Arrays.toString`.

Sample input:

```text
4
3 -1 0 12
```

Sample output:

```text
[6, -2, 0, 24]
```

**Q10. Carriage Chain.** Using a class `Carriage` with fields `int passengers` and `Carriage next`, read `n` (at least 1) and then `n` passenger counts. Build a chain of `n` carriages in input order, keeping a reference only to the **first** carriage. Then traverse the chain from the first carriage to print the total number of passengers and the largest carriage load.

Sample input:

```text
4
30 25 40 18
```

Sample output:

```text
Total: 113
Largest: 40
```

### Level 5: Challenge

**Q11. Friend Chain.** Read `n` people. Each input line gives a name and the index (0 to `n - 1`) of that person's best friend, or `-1` for none. Using a class `Person` with fields `String name`, `Person bestFriend` and `boolean visited`, create all `n` objects first, then set each `bestFriend` reference. Starting from person 0, follow `bestFriend` references, printing each name on its own line. Stop when you reach `null`, or when you reach a person already visited, in which case print `Cycle at <name>` for that person.

Sample input:

```text
4
Asha 2
Ben 0
Chen 3
Dina 2
```

Sample output:

```text
Asha
Chen
Dina
Cycle at Chen
```

<!-- section: solution -->
## Solutions

**Q1.** B. `q` is an alias of `p`.

**Q2.** B.

**Q3.** B.

**Q4.** C.

**Q5.**

```output
30 9 3
false false
```

`b` still points to the original array, whose element 2 was changed to 30. `a` was redirected to a new array of nines. `c` is a separate array. `b == c` compares two different arrays, and `a == b` is now false because `a` was reassigned.

**Q6.**

```output
150
hello
HELLO
```

`update` adds 50 through the shared reference, which the caller sees. It then points its parameter at a new account, so the extra 500 goes to that new object, not to `acc`. `shout` reassigns only its own parameter, and Strings are immutable, so `s` is unchanged until `main` assigns the result of `toUpperCase()` itself.

**Q7.** For Strings, `==` checks whether two references point to the same object, not whether the characters match. Two separate String objects can contain identical text, for example when one is created with `new String("SLIIT")` or built from input, so `==` returns `false`. Strings must be compared with `first.equals(second)`, which compares their characters.

**Q8.** Java passes arguments by value, and for an array the value passed is a reference, so the parameter and the caller's variable point to the same array object. Setting elements through the parameter changes that shared array, which the caller then sees. Assigning a new array to the parameter only redirects the method's copy of the reference; the caller's variable still points to the original array.

**Q9.**

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
        doubleAll(a);
        System.out.println(Arrays.toString(a));
    }

    public static void doubleAll(int[] a) {
        for (int i = 0; i < a.length; i++) {
            a[i] *= 2;
        }
    }
}
```

```input
4
3 -1 0 12
```

```output
[6, -2, 0, 24]
```

**Q10.** Keep a reference to the first carriage and another to the last one added, so each new carriage can be attached to the end.

```java
import java.util.Scanner;

public class Main {
    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        int n = sc.nextInt();
        Carriage first = new Carriage(sc.nextInt());
        Carriage last = first;
        for (int i = 1; i < n; i++) {
            Carriage c = new Carriage(sc.nextInt());
            last.next = c;
            last = c;
        }
        int total = 0;
        int largest = first.passengers;
        Carriage current = first;
        while (current != null) {
            total += current.passengers;
            if (current.passengers > largest) {
                largest = current.passengers;
            }
            current = current.next;
        }
        System.out.println("Total: " + total);
        System.out.println("Largest: " + largest);
    }
}

class Carriage {
    int passengers;
    Carriage next;

    Carriage(int passengers) {
        this.passengers = passengers;
    }
}
```

```input
4
30 25 40 18
```

```output
Total: 113
Largest: 40
```

**Q11.** All objects are created first, because a best friend may appear later in the input. The `visited` flag is set on each person as the chain reaches them.

```java
import java.util.Scanner;

public class Main {
    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        int n = sc.nextInt();
        Person[] people = new Person[n];
        int[] friendIndex = new int[n];
        for (int i = 0; i < n; i++) {
            people[i] = new Person(sc.next());
            friendIndex[i] = sc.nextInt();
        }
        for (int i = 0; i < n; i++) {
            if (friendIndex[i] != -1) {
                people[i].bestFriend = people[friendIndex[i]];
            }
        }
        Person current = people[0];
        while (current != null) {
            if (current.visited) {
                System.out.println("Cycle at " + current.name);
                break;
            }
            System.out.println(current.name);
            current.visited = true;
            current = current.bestFriend;
        }
    }
}

class Person {
    String name;
    Person bestFriend;
    boolean visited;

    Person(String name) {
        this.name = name;
    }
}
```

```input
4
Asha 2
Ben 0
Chen 3
Dina 2
```

```output
Asha
Chen
Dina
Cycle at Chen
```

<!-- section: rubric -->
## Marking Rubrics

**Q7 (Explain, 3 marks)**
- 1 mark: states that `==` compares references (identity), not contents.
- 1 mark: explains that two distinct String objects can hold the same characters.
- 1 mark: states that `equals` must be used.

**Q8 (Explain, 3 marks)**
- 1 mark: states that Java passes by value and that the value for an array is a reference.
- 1 mark: explains that changes to elements affect the single shared array.
- 1 mark: explains that reassigning the parameter redirects only the method's copy.

**Q9 to Q11 (Implement and Challenge)**
- Output matches exactly on all hidden tests: full marks.
- Q9's `doubleAll` must be `void` and modify the array in place.
- Q10 must build a linked chain of objects and traverse it by following `next` references; storing the values in an array and summing it receives partial marks.
- Q11 must link `Person` objects by reference and must detect repeated people using the `visited` field. Hidden tests include a chain ending in `null` and a person who is their own best friend.

<!-- section: further_practice -->
## Further Practice

- HackerRank, Java: *Java String Compare* (https://www.hackerrank.com/challenges/java-string-compare/problem)
- LeetCode 876: *Middle of the Linked List* (https://leetcode.com/problems/middle-of-the-linked-list/) (a first look at the next module)
