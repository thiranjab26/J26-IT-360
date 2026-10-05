---
concept_id: prog.classes_objects
module: prog
sequence: 11
topic: Objects
title: "11. Classes and Objects"
prerequisites: [prog.methods]
cross_module_prerequisites: []
difficulty: 3
java_version: 21
version: 1
status: draft
---

# 11. Classes and Objects

<!-- section: objectives -->
## Learning Objectives

After this concept you should be able to:

1. Explain the difference between a class and an object.
2. Define a class with fields, a constructor and instance methods.
3. Create objects with `new` and call their methods.
4. Explain the difference between `static` and instance members.
5. Use `private` fields with methods that control access, and override `toString`.

<!-- section: prerequisites -->
## Before You Start

From **Methods** you need to define methods with parameters and return values, and understand that `static` methods can be called without an object. This concept finally explains what that means.

<!-- section: theory -->
## Theory

### Why Classes

So far, programs have stored data in separate variables and arrays, and processed it with static methods. For a student, that might mean one array of names, another of IDs and another of marks, kept in step by index. This is fragile: nothing ties a name to its mark.

A **class** lets you define a new type that bundles related **data** (fields) with the **behaviour** that works on it (methods). A `Student` type can hold a name, an ID and a mark together, and provide methods such as `hasPassed()`.

<!-- section: theory -->
### Classes and Objects

A **class** is a blueprint: it describes what data each object of that type holds and what it can do. An **object** is a particular instance built from that blueprint, with its own values.

`Student` is a class. The student named Amal with mark 72 is one object; the student named Nimali with mark 85 is another. Both are `Student` objects, and each has its **own** copy of the fields.

You have already used objects: every `String` is an object of the `String` class, and `sc` in `Scanner sc = new Scanner(System.in)` is a `Scanner` object.

<!-- section: theory -->
### Defining a Class

```java
class Student {
    String name;        // fields: each Student object has its own
    int mark;

    Student(String name, int mark) {    // constructor
        this.name = name;
        this.mark = mark;
    }

    boolean hasPassed() {               // instance method
        return mark >= 40;
    }
}
```

**Fields** (also called instance variables) are declared inside the class but outside any method, **without** `static`. Every object gets its own set. Fields that are not given a value receive defaults: 0, `false` or `null`.

<!-- section: theory -->
### Constructors

A **constructor** initialises a new object. It has the **same name as the class** and **no return type**, not even `void`. It runs automatically when an object is created with `new`.

Inside a constructor or instance method, `this` refers to the current object. `this.name = name;` means "store the parameter `name` in this object's field `name`". The `this.` is needed here because the parameter has the same name as the field and would otherwise shadow it.

If a class defines no constructor, Java supplies a **default constructor** with no parameters. Once you write any constructor yourself, the default one is no longer provided. A class can have several constructors with different parameter lists; this is constructor overloading.

<!-- section: theory -->
### Creating Objects and Calling Methods

```java
Student s1 = new Student("Amal", 72);
Student s2 = new Student("Nimali", 35);

System.out.println(s1.name);          // Amal
System.out.println(s2.hasPassed());   // false
s2.mark = 45;
System.out.println(s2.hasPassed());   // true
```

`new Student(...)` creates an object and runs the constructor. The **dot operator** accesses an object's fields and methods: `s1.name`, `s2.hasPassed()`. An instance method uses the fields of the object it was called on, so `s1.hasPassed()` checks Amal's mark and `s2.hasPassed()` checks Nimali's.

<!-- section: theory -->
### static Versus Instance

This explains the `static` keyword you have written since concept 1.

| | Instance member | Static member |
|---|---|---|
| Declared | Without `static` | With `static` |
| Belongs to | Each individual object | The class as a whole |
| Field copies | One per object | Exactly one, shared by all objects |
| Called as | `object.method()` | `ClassName.method()`, or just `method()` inside the class |
| Can use instance fields directly | Yes | No, because there is no current object |

`main` is `static` because the JVM calls it before any object exists. That is also why `main` cannot call an instance method such as `hasPassed()` on its own: it must first create an object and call the method on it. A static method that tries to use an instance field or method directly fails to compile with "non-static ... cannot be referenced from a static context".

<!-- section: theory -->
### Encapsulation: private Fields

Fields that anyone can change are risky: nothing stops `account.balance = -5000;`. **Encapsulation** hides fields by declaring them `private`, so they can only be used inside the class, and provides methods that control access:

```java
class BankAccount {
    private double balance;

    public double getBalance() {          // getter
        return balance;
    }

    public boolean withdraw(double amount) {
        if (amount <= 0 || amount > balance) {
            return false;                 // rule enforced in one place
        }
        balance -= amount;
        return true;
    }
}
```

Outside the class, `account.balance` does not compile; code must use `getBalance()` and `withdraw(...)`, which enforce the rules. A method that returns a field is a **getter**; one that changes a field after checking the new value is a **setter**.

<!-- section: theory -->
### toString

Printing an object with `System.out.println(s1)` calls its `toString()` method. By default this prints the class name and an identifier, such as `Student@5a07e868`. Defining your own `toString` gives a readable form:

```java
@Override
public String toString() {
    return name + " (" + mark + ")";
}
```

`@Override` tells the compiler you intend to replace an inherited method, so it can warn you if the name or signature is wrong.

<!-- section: theory -->
### Several Classes in One File

A file may contain only **one public class**, whose name matches the file. Other classes can be placed in the same file without the `public` modifier. All exercises in this course use that layout: `public class Main` plus any helper classes declared as `class Student`, `class BankAccount` and so on.

<!-- section: example -->
## Worked Examples

### Example 1: Two Independent Objects

```java
public class Main {
    public static void main(String[] args) {
        Student s1 = new Student("Amal", 72);
        Student s2 = new Student("Nimali", 35);
        System.out.println(s1);
        System.out.println(s2);
        System.out.println(s1.hasPassed() + " " + s2.hasPassed());
        s2.mark = s2.mark + 10;
        System.out.println(s2 + " " + s2.hasPassed());
        System.out.println(s1);
    }
}

class Student {
    String name;
    int mark;

    Student(String name, int mark) {
        this.name = name;
        this.mark = mark;
    }

    boolean hasPassed() {
        return mark >= 40;
    }

    @Override
    public String toString() {
        return name + " (" + mark + ")";
    }
}
```

```output
Amal (72)
Nimali (35)
true false
Nimali (45) true
Amal (72)
```

Changing `s2.mark` affects only Nimali's object. Amal's object has its own `mark` and is untouched.

<!-- section: example -->
### Example 2: Instance Fields Versus a Static Field

```java
public class Main {
    public static void main(String[] args) {
        Ticket a = new Ticket("Colombo");
        Ticket b = new Ticket("Kandy");
        Ticket c = new Ticket("Galle");
        System.out.println(a.number + " " + a.destination);
        System.out.println(c.number + " " + c.destination);
        System.out.println("Issued: " + Ticket.issued);
    }
}

class Ticket {
    static int issued = 0;
    int number;
    String destination;

    Ticket(String destination) {
        issued++;
        this.number = issued;
        this.destination = destination;
    }
}
```

```output
1 Colombo
3 Galle
Issued: 3
```

`issued` is static, so there is one copy shared by all tickets; it counts every ticket created. `number` and `destination` are instance fields, so each ticket keeps its own. The static field is accessed through the class name, `Ticket.issued`.

<!-- section: example -->
### Example 3: Encapsulation with a Bank Account

```java
public class Main {
    public static void main(String[] args) {
        BankAccount acc = new BankAccount("A-101", 1000);
        System.out.println(acc.deposit(500));
        System.out.println(acc.withdraw(2000));
        System.out.println(acc.withdraw(300));
        System.out.println(acc.deposit(-50));
        System.out.println(acc);
    }
}

class BankAccount {
    private String id;
    private double balance;

    BankAccount(String id, double openingBalance) {
        this.id = id;
        this.balance = openingBalance;
    }

    public boolean deposit(double amount) {
        if (amount <= 0) {
            return false;
        }
        balance += amount;
        return true;
    }

    public boolean withdraw(double amount) {
        if (amount <= 0 || amount > balance) {
            return false;
        }
        balance -= amount;
        return true;
    }

    public double getBalance() {
        return balance;
    }

    @Override
    public String toString() {
        return id + ": " + balance;
    }
}
```

```output
true
false
true
false
A-101: 1200.0
```

Every change to the balance goes through `deposit` or `withdraw`, which reject invalid amounts. Code in `Main` cannot write `acc.balance = -5000;`, because `balance` is private.

<!-- section: misconception -->
## Common Misconceptions

**"A class and an object are the same thing."**
A class is the blueprint; objects are the instances built from it. One class can produce many objects.

**"All objects of a class share the same field values."**
Each object has its own copy of every instance field. Only `static` fields are shared.

**"A constructor has return type `void`."**
A constructor has no return type at all. Writing `void Student(...)` creates an ordinary method named `Student`, not a constructor.

**"`main` can call an instance method directly."**
`main` is static and has no current object. It must create an object and call the method on it.

**"`this` is always optional."**
It is needed when a parameter or local variable has the same name as a field; otherwise the name refers to the parameter.

**"`private` fields cannot be used anywhere."**
They can be used freely inside their own class, just not from other classes.

**"Declaring a variable of a class type creates an object."**
`Student s;` only declares a variable. An object exists only after `new Student(...)`.

<!-- section: facts -->
## Key Facts

- A class defines a new type that combines fields (data) and methods (behaviour).
- An object is an instance of a class, created with `new`.
- Each object has its own copy of every instance field.
- Fields without an explicit value receive default values (0, `false` or `null`).
- A constructor has the same name as its class and no return type.
- A constructor runs automatically when an object is created with `new`.
- If a class declares no constructor, Java provides a default constructor with no parameters.
- `this` refers to the current object; `this.name = name` assigns a parameter to a field of the same name.
- The dot operator accesses an object's fields and methods.
- An instance method operates on the fields of the object it is called on.
- A static field has exactly one copy shared by all objects of the class.
- A static method has no current object and cannot use instance fields or methods directly.
- `main` is static because it runs before any object exists.
- A `private` member can only be accessed inside its own class.
- Encapsulation hides fields and exposes methods that enforce rules.
- `System.out.println(obj)` prints the result of `obj.toString()`.
- A file can contain only one public class, and its name must match the file name.

<!-- section: exercise -->
## Practice Questions

### Level 1: Recall (MCQ)

**Q1.** Which statement about constructors is correct?
A. They return `void`  B. They have the same name as the class and no return type  C. They must be called explicitly after `new`  D. A class can have only one

**Q2.** A class `Car` has a static field `count` and an instance field `colour`. Five `Car` objects exist. How many copies of each field exist?
A. 5 and 5  B. 1 and 1  C. 1 and 5  D. 5 and 1

**Q3.** Why can `main` not call an instance method `describe()` directly?
A. Instance methods cannot be called from other methods  B. `main` is static and has no current object  C. `describe` must be private  D. It can, with no restriction

**Q4.** What does `private` on a field mean?
A. The field cannot change  B. The field can only be accessed inside its own class  C. The field is shared by all objects  D. The field is hidden from the class's own methods

### Level 2: Trace and Predict

**Q5.** What does this program print?

```java
public class Main {
    public static void main(String[] args) {
        Counter a = new Counter();
        Counter b = new Counter();
        a.increment();
        a.increment();
        b.increment();
        System.out.println(a.value + " " + b.value + " " + Counter.total);
    }
}

class Counter {
    static int total = 0;
    int value;

    void increment() {
        value++;
        total++;
    }
}
```

**Q6.** What does this program print?

```java
public class Main {
    public static void main(String[] args) {
        Point p = new Point(2, 3);
        Point q = new Point(5, 7);
        p.move(1, 1);
        System.out.println(p);
        System.out.println(q.distanceSquared(p));
        System.out.println(new Point(0, 0));
    }
}

class Point {
    int x;
    int y;

    Point(int x, int y) {
        this.x = x;
        this.y = y;
    }

    void move(int dx, int dy) {
        x += dx;
        y += dy;
    }

    int distanceSquared(Point other) {
        int dx = x - other.x;
        int dy = y - other.y;
        return dx * dx + dy * dy;
    }

    @Override
    public String toString() {
        return "(" + x + ", " + y + ")";
    }
}
```

### Level 3: Explain

**Q7.** Explain the difference between a static field and an instance field, using a class `Student` with a field `name` and a field that counts how many students have been created.

**Q8.** A student writes this constructor and finds that every `Book` has a `null` title. Explain why and fix it.

```java
class Book {
    String title;

    Book(String title) {
        title = title;
    }
}
```

### Level 4: Implement

**Q9. Rectangle.** Write a class `Rectangle` with `int` fields `width` and `height`, a constructor, and methods `area()` and `perimeter()`. In `main`, read the width and height, create a `Rectangle`, and print its area and perimeter on two lines.

Sample input:

```text
7 4
```

Sample output:

```text
Area: 28
Perimeter: 22
```

**Q10. Thermostat.** Write a class `Thermostat` with a `private int temperature`, a constructor taking a starting temperature, `getTemperature()`, and `setTemperature(int t)` that only accepts values from 16 to 30 inclusive and returns `true` if the change was accepted. In `main`, read a starting temperature and then `k` requested values. For each request print `accepted` or `rejected`, and finally print the temperature.

Sample input:

```text
24
3
18 35 29
```

Sample output:

```text
accepted
rejected
accepted
Final: 29
```

### Level 5: Challenge

**Q11. Fraction.** Write a class `Fraction` with `private int` fields `num` and `den`. The constructor must store the fraction in lowest terms with a positive denominator (for example `new Fraction(4, -6)` is stored as -2/3). Provide `add(Fraction other)`, which returns a **new** `Fraction`, and `toString()`, which returns `num/den`. Use a static helper `gcd`. Read two fractions as four integers `a b c d` (meaning a/b and c/d, with non-zero denominators) and print each fraction and their sum.

Sample input:

```text
1 6 1 3
```

Sample output:

```text
1/6
1/3
1/2
```

<!-- section: solution -->
## Solutions

**Q1.** B.

**Q2.** C. One shared static field, and one `colour` per object.

**Q3.** B.

**Q4.** B.

**Q5.**

```output
2 1 3
```

Each `Counter` has its own `value`: `a` was incremented twice and `b` once. `total` is static, so all three calls add to the same field.

**Q6.**

```output
(3, 4)
13
(0, 0)
```

`p` moves from (2, 3) to (3, 4). `q.distanceSquared(p)` computes `(5 - 3)² + (7 - 4)²`, which is 4 + 9 = 13. Printing an object calls its `toString`.

**Q7.** An instance field such as `name` belongs to each object, so every `Student` has its own name: changing one student's name affects no other student. A static field such as `static int created` belongs to the class, so there is exactly one copy shared by all students. If the constructor increments `created`, every new student adds to the same counter, which then records the total number created. The instance field is accessed through an object (`s.name`), and the static field through the class (`Student.created`).

**Q8.** Inside the constructor, the parameter `title` shadows the field `title`, so `title = title;` assigns the parameter to itself and never touches the field. The field keeps its default value, `null`. The fix is to refer to the field with `this`:

```java
Book(String title) {
    this.title = title;
}
```

**Q9.**

```java
import java.util.Scanner;

public class Main {
    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        Rectangle r = new Rectangle(sc.nextInt(), sc.nextInt());
        System.out.println("Area: " + r.area());
        System.out.println("Perimeter: " + r.perimeter());
    }
}

class Rectangle {
    int width;
    int height;

    Rectangle(int width, int height) {
        this.width = width;
        this.height = height;
    }

    int area() {
        return width * height;
    }

    int perimeter() {
        return 2 * (width + height);
    }
}
```

```input
7 4
```

```output
Area: 28
Perimeter: 22
```

**Q10.**

```java
import java.util.Scanner;

public class Main {
    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        Thermostat t = new Thermostat(sc.nextInt());
        int k = sc.nextInt();
        for (int i = 0; i < k; i++) {
            boolean ok = t.setTemperature(sc.nextInt());
            System.out.println(ok ? "accepted" : "rejected");
        }
        System.out.println("Final: " + t.getTemperature());
    }
}

class Thermostat {
    private int temperature;

    Thermostat(int temperature) {
        this.temperature = temperature;
    }

    public int getTemperature() {
        return temperature;
    }

    public boolean setTemperature(int t) {
        if (t < 16 || t > 30) {
            return false;
        }
        temperature = t;
        return true;
    }
}
```

```input
24
3
18 35 29
```

```output
accepted
rejected
accepted
Final: 29
```

**Q11.** Normalising in the constructor means every `Fraction` is always in lowest terms, however it was created, including the results of `add`.

```java
import java.util.Scanner;

public class Main {
    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        Fraction f1 = new Fraction(sc.nextInt(), sc.nextInt());
        Fraction f2 = new Fraction(sc.nextInt(), sc.nextInt());
        System.out.println(f1);
        System.out.println(f2);
        System.out.println(f1.add(f2));
    }
}

class Fraction {
    private int num;
    private int den;

    Fraction(int num, int den) {
        if (den < 0) {
            num = -num;
            den = -den;
        }
        int g = gcd(Math.abs(num), den);
        this.num = num / g;
        this.den = den / g;
    }

    Fraction add(Fraction other) {
        return new Fraction(num * other.den + other.num * den, den * other.den);
    }

    static int gcd(int a, int b) {
        while (b != 0) {
            int t = a % b;
            a = b;
            b = t;
        }
        return a;
    }

    @Override
    public String toString() {
        return num + "/" + den;
    }
}
```

```input
1 6 1 3
```

```output
1/6
1/3
1/2
```

For a numerator of 0, `gcd(0, den)` is `den`, so `new Fraction(0, 5)` is stored as `0/1` and there is never a division by zero, since denominators are non-zero.

<!-- section: rubric -->
## Marking Rubrics

**Q7 (Explain, 3 marks)**
- 1 mark: instance field belongs to each object, with each student holding its own `name`.
- 1 mark: static field belongs to the class, with one shared copy.
- 1 mark: explains how a static counter incremented in the constructor records the number of students created.

**Q8 (Explain, 2 marks)**
- 1 mark: identifies that the parameter shadows the field, so the assignment targets the parameter.
- 1 mark: gives the fix `this.title = title;`.

**Q9 to Q11 (Implement and Challenge)**
- Output matches exactly on all hidden tests: full marks.
- The required classes and methods must be used; logic written only in `main` receives partial marks.
- Q10's field must be `private` and all changes must go through `setTemperature`.
- Q11 must normalise sign and lowest terms in the constructor, and `add` must return a new object rather than changing either operand. Hidden tests include negative values and zero numerators.

<!-- section: further_practice -->
## Further Practice

- HackerRank, Java: *Java Method Overriding* (https://www.hackerrank.com/challenges/java-method-overriding/problem)
- HackerRank, Java: *Java Inheritance I* (https://www.hackerrank.com/challenges/java-inheritance-1/problem) (goes beyond this module)
- LeetCode 1603: *Design Parking System* (https://leetcode.com/problems/design-parking-system/)
