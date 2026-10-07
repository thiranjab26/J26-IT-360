from app.db.tables import Bank
from app.integrations.context import MATERIAL, TOPICS
from app.models.schemas import BankQuestion

# Human-readable seed content is marked demo-approved, never expert reviewed.
CONTENT = [
    (
        "stacks",
        "LIFO",
        "Explain the order in which a stack removes items. Give an example with two items.",
        "LIFO means last-in, first-out. If A is pushed then B, B is removed first.",
        [
            (
                "lifo",
                "Explain last-in, first-out order.",
                [
                    "lifo",
                    "last in first out",
                    "last item",
                    "last added",
                    "most recently",
                    "last inserted",
                    "newest",
                ],
            ),
            (
                "example",
                "Apply the order to an example: A then B means B is removed first.",
                [
                    "b first",
                    "b is removed",
                    "b comes out",
                    "pop b",
                    "b is popped",
                    "b would",
                    "b will",
                    "b gets",
                    "b then a",
                    "2 then 1",
                    "second item",
                ],
            ),
        ],
        [
            (
                "fifo",
                "A stack removes the oldest item first.",
                [
                    "stack follows fifo",
                    "stack is fifo",
                    "first in first out",
                    "a is removed first",
                    "a comes out first",
                    "oldest first",
                ],
            )
        ],
    ),
    (
        "stacks",
        "Push and pop",
        "Describe push and pop in a stack, and what happens when popping an empty stack.",
        "Push adds an item to the top; pop removes the top item. Popping an empty stack causes underflow.",
        [
            (
                "push",
                "Push adds an item to the top.",
                ["push adds", "push inserts", "add to the top", "adds to the top"],
            ),
            (
                "pop",
                "Pop removes the top item.",
                ["pop removes", "pop takes", "remove the top", "removes from the top"],
            ),
            (
                "underflow",
                "An empty-stack pop causes underflow or an empty-stack error.",
                ["underflow", "empty stack error", "error", "exception"],
            ),
        ],
        [("bottom", "Pop removes the bottom item.", ["pop removes the bottom", "pop from bottom"])],
    ),
    (
        "queues",
        "FIFO",
        "Explain the removal order of a queue. Give an example with A arriving before B.",
        "FIFO means first-in, first-out. A arrives before B, so A leaves first.",
        [
            (
                "fifo",
                "Explain first-in, first-out order.",
                ["fifo", "first in first out", "oldest", "earliest", "first added"],
            ),
            (
                "example",
                "Apply FIFO to A arriving before B: A leaves first.",
                [
                    "a first",
                    "a leaves",
                    "a is removed",
                    "a comes out",
                    "a then b",
                    "a would",
                    "a will",
                ],
            ),
        ],
        [
            (
                "lifo",
                "A queue removes the most recent item first.",
                ["queue is lifo", "last in first out", "b leaves first", "newest first"],
            )
        ],
    ),
    (
        "queues",
        "Enqueue and dequeue",
        "Where do enqueue and dequeue operate, and why is a queue useful for task scheduling?",
        "Enqueue adds at the rear; dequeue removes at the front. Tasks are served in arrival order.",
        [
            ("enqueue", "Enqueue adds at the rear.", ["rear", "back"]),
            ("dequeue", "Dequeue removes at the front.", ["front"]),
            (
                "schedule",
                "Arrival order supports orderly task scheduling.",
                ["arrival order", "in order", "first come", "fair", "fifo"],
            ),
        ],
        [
            (
                "reverse",
                "Dequeue removes the newest item from the rear.",
                ["dequeue from rear", "dequeue removes from the back", "dequeue removes newest"],
            )
        ],
    ),
    (
        "oop",
        "Encapsulation",
        "Explain encapsulation and how it protects an object’s state.",
        "Encapsulation bundles data and methods and restricts access to internal state through a controlled interface.",
        [
            (
                "bundle",
                "Bundle related data and methods.",
                ["data and methods", "data with methods", "bundles", "bundling"],
            ),
            (
                "access",
                "Restrict direct access to internal state.",
                ["private", "restrict", "hide", "hiding", "controlled access"],
            ),
            (
                "invariants",
                "A controlled interface protects valid state.",
                ["invariant", "valid", "protect", "control", "getter", "setter"],
            ),
        ],
        [
            (
                "public",
                "Encapsulation means all data must be public.",
                ["all data is public", "all fields public", "everything public"],
            )
        ],
    ),
    (
        "oop",
        "Inheritance",
        "Explain inheritance and distinguish it from composition.",
        "Inheritance allows a subclass to reuse or extend a superclass and represents is-a. Composition represents has-a.",
        [
            (
                "reuse",
                "Subclass reuses or extends a superclass.",
                ["reuse", "extend", "inherits", "parent class", "superclass"],
            ),
            ("is_a", "Inheritance represents is-a.", ["is a", "is-a"]),
            ("has_a", "Composition represents has-a.", ["has a", "has-a", "contains another"]),
        ],
        [
            (
                "mix",
                "Inheritance is a has-a relationship.",
                ["inheritance means has a", "inheritance is has a", "inheritance is a has-a"],
            )
        ],
    ),
    (
        "databases",
        "Database keys",
        "Explain the roles of primary and foreign keys.",
        "A primary key uniquely identifies a row and is non-null. A foreign key references another key and enforces referential integrity.",
        [
            ("primary", "A primary key uniquely identifies a row.", ["unique", "uniquely"]),
            (
                "null",
                "Primary key values cannot be null.",
                ["not null", "non null", "cannot be null", "no null"],
            ),
            (
                "foreign",
                "A foreign key references another key to maintain relationships.",
                ["references", "reference", "referential", "links", "relationship"],
            ),
        ],
        [
            (
                "duplicates",
                "Primary keys allow duplicate values.",
                [
                    "primary keys allow duplicates",
                    "primary key can have duplicates",
                    "primary key allows null",
                ],
            )
        ],
    ),
    (
        "databases",
        "Normalization",
        "What is normalization, and what problems does it address?",
        "Normalization organizes related facts into tables to reduce redundancy and prevent update, insertion, and deletion anomalies.",
        [
            (
                "organize",
                "Organize related facts into appropriate tables.",
                ["tables", "relations", "organize", "decompose"],
            ),
            ("redundancy", "Reduce data redundancy.", ["redundan", "duplicate", "duplication"]),
            (
                "anomalies",
                "Avoid data modification anomalies.",
                [
                    "anomal",
                    "update problem",
                    "insertion problem",
                    "deletion problem",
                    "inconsisten",
                ],
            ),
        ],
        [
            (
                "increase",
                "Normalization aims to increase duplication.",
                ["increase duplication", "increases redundancy", "more duplicate"],
            )
        ],
    ),
]


def seed_questions():
    result = []
    for index, (topic, concept, question, answer, points, errors) in enumerate(CONTENT):
        item = dict(
            id=f"demo-{topic}-{index + 1}",
            topic_id=topic,
            concept=concept,
            question=question,
            reference_answer=answer,
            rubric_points=[{"id": p[0], "point": p[1], "keywords": p[2]} for p in points],
            misconceptions=[{"id": p[0], "description": p[1], "keywords": p[2]} for p in errors],
            follow_ups={
                "partial": f"Please complete your explanation of {concept}; address any part of the original question you have not yet explained.",
                "superficial": f"Explain why {concept} works this way, using a concrete example.",
                "incorrect": f"Let us take one step at a time. What is the basic purpose of {concept}? Explain the rule in your own words.",
                "misconception_bearing": f"Check your proposed rule for {concept} against a small example. What result do you expect, and why?",
                "non_answer": f"In your own words, what do you understand about {concept}? You may use a short example.",
            },
            sources=[
                {
                    "source": f"Demo {TOPICS[topic][0]} course notes",
                    "page": 1,
                    "text": MATERIAL[topic],
                }
            ],
            status="approved",
            origin="demo_seed",
            review_notes="Sample approval for local demonstration only; not expert reviewed.",
            version=1,
        )
        for point in item["rubric_points"]:
            point["probe"] = PROBES[(concept, point["id"])]
        result.append(BankQuestion.model_validate(item).model_dump())
    return result


def seed(db):
    for item in seed_questions():
        existing = db.get(Bank, item["id"])
        if existing is None:
            db.add(Bank(id=item["id"], topic_id=item["topic_id"], status=item["status"], data=item))
        elif existing.data.get("origin") == "demo_seed" and existing.data.get("version") == 1:
            # Add probes only to untouched demo seeds; instructor revisions and session snapshots stay immutable.
            data = dict(existing.data)
            probes = {p["id"]: p["probe"] for p in item["rubric_points"]}
            data["rubric_points"] = [
                {**p, "probe": p.get("probe") or probes.get(p["id"])} for p in data["rubric_points"]
            ]
            existing.data = data
    db.commit()


PROBES = {
    ("LIFO", "lifo"): "What rule determines which item a stack removes next?",
    (
        "LIFO",
        "example",
    ): "Suppose you push A and then B onto an empty stack. Trace two pops and explain your reasoning.",
    (
        "Push and pop",
        "push",
    ): "Where does a push place the new item relative to the existing items?",
    ("Push and pop", "pop"): "Which item does pop select, and how does the stack change?",
    ("Push and pop", "underflow"): "How should a pop behave when the stack contains no items?",
    ("FIFO", "fifo"): "What determines which waiting item a queue removes next?",
    ("FIFO", "example"): "A joins a queue before B. Trace two removals and explain your reasoning.",
    ("Enqueue and dequeue", "enqueue"): "Where is a newly enqueued item placed?",
    ("Enqueue and dequeue", "dequeue"): "Which position does dequeue remove from?",
    (
        "Enqueue and dequeue",
        "schedule",
    ): "How would you use a queue to schedule waiting tasks, and why?",
    ("Encapsulation", "bundle"): "What does an encapsulated object bring together?",
    (
        "Encapsulation",
        "access",
    ): "How can other code interact with the internal state of an encapsulated object?",
    ("Encapsulation", "invariants"): "Why might an object control how callers change its state?",
    ("Inheritance", "reuse"): "How is a subclass related to the implementation of its superclass?",
    (
        "Inheritance",
        "is_a",
    ): "Give a relationship that is appropriate for inheritance and explain why.",
    (
        "Inheritance",
        "has_a",
    ): "Give a relationship that is appropriate for composition and explain why.",
    ("Database keys", "primary"): "What must a primary key let you determine about a row?",
    ("Database keys", "null"): "Could a primary key value be absent? Explain your reasoning.",
    ("Database keys", "foreign"): "How does a foreign key connect records and constrain changes?",
    (
        "Normalization",
        "organize",
    ): "What changes to the structure of tables can normalization involve?",
    (
        "Normalization",
        "redundancy",
    ): "How can storing the same fact in multiple rows cause problems?",
    (
        "Normalization",
        "anomalies",
    ): "Describe a problem that could arise when inserting, changing, or deleting poorly organized data.",
}
