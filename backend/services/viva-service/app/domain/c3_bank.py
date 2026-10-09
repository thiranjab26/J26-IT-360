"""Sample viva bank built from C3's course catalogue (database/seed/concepts_*.csv).

Each C3 topic becomes a C4 course (a viva topic). The course holds one material: for each
concept, C3's name and description followed by short revision notes. Each concept gets one
approved question whose rubric points quote that material, so the bank's grounding check
passes when staff edit and re-approve them. Written for the PP1 demo from the C3
descriptions (9 Oct 2026); sample approval, not expert reviewed.
"""

import hashlib

from sqlalchemy import delete, select

from app.db.tables import (
    Bank,
    Course,
    HumanRating,
    IntegrationEvent,
    Material,
    Result,
    Token,
    Turn,
    User,
    VivaSession,
)
from app.models.schemas import BankQuestion

ORIGIN = "c3_catalogue"
REVIEW_NOTES = (
    "Sample approval for the PP1 demo, written from the C3 concept catalogue; not expert reviewed."
)
MODULES = {
    "IT2070": "Data Structures and Algorithms",
    "IT1010": "Programming Fundamentals",
}

# (course key, module code, C3 topic, concept ids), in the C3 catalogue's own order.
COURSES = [
    ("it2070-complexity", "IT2070", "Complexity", ["dsa.big_o", "dsa.complexity_classes"]),
    (
        "it2070-linear-structures",
        "IT2070",
        "Linear structures",
        ["dsa.array_costs", "dsa.linked_list", "dsa.stack", "dsa.queue"],
    ),
    (
        "it2070-recursion",
        "IT2070",
        "Recursion",
        ["dsa.call_stack", "dsa.recursion_cases", "dsa.recursion_tracing"],
    ),
    ("it2070-trees", "IT2070", "Trees", ["dsa.tree_traversal", "dsa.bst"]),
    ("it2070-sorting", "IT2070", "Sorting", ["dsa.merge_sort"]),
    (
        "it1010-basics",
        "IT1010",
        "Programming basics",
        ["prog.variables_types", "prog.operators_expressions"],
    ),
    (
        "it1010-control-flow",
        "IT1010",
        "Control flow",
        ["prog.conditionals", "prog.loops", "prog.nested_loops"],
    ),
    (
        "it1010-functions",
        "IT1010",
        "Functions",
        ["prog.functions", "prog.return_values_scope", "prog.call_flow"],
    ),
    (
        "it1010-collections",
        "IT1010",
        "Collections",
        ["prog.lists_indexing", "prog.collection_iteration", "prog.references_mutability"],
    ),
    ("it1010-program-tracing", "IT1010", "Program tracing", ["prog.code_tracing"]),
]

# name and description are C3's own (the seed CSVs); notes, questions and rubrics are C4's.
# points: (id, point, demo keywords, non-leading probe, evidence quote from the material)
CONCEPTS = {
    "dsa.big_o": dict(
        name="Big-O and growth rate",
        description="Counting operations as input grows and expressing the growth with Big-O",
        notes="We count how many basic operations an algorithm performs as the input size n grows. Big-O keeps only the fastest-growing term and drops constant factors, so 3n + 5 operations is O(n). Big-O describes how the running time grows, not the exact time in seconds. A loop that visits each of n items once does O(n) work; a loop inside another loop over the same n items does O(n^2) work.",
        question="What does Big-O notation tell us about an algorithm? Use a loop over n items as your example.",
        answer="Big-O describes how the number of operations grows as the input size n grows, keeping only the fastest-growing term and ignoring constant factors, so 3n + 5 is O(n). A loop that visits each of n items once is O(n); a loop nested inside another loop over the same items is O(n^2).",
        points=[
            (
                "growth",
                "Big-O describes how the number of operations grows with the input size n, not the exact time.",
                [
                    "grows",
                    "growth",
                    "input size",
                    "as n increases",
                    "number of operations",
                    "scales",
                    "rate of growth",
                ],
                "When we write O(n), what is changing as n gets bigger?",
                "Big-O describes how the running time grows, not the exact time in seconds",
            ),
            (
                "drop_constants",
                "Constant factors and smaller terms are dropped: 3n + 5 is O(n).",
                [
                    "drop constants",
                    "ignore constants",
                    "constant factors",
                    "fastest growing term",
                    "dominant term",
                    "highest order",
                    "ignore the 5",
                ],
                "If an algorithm does 3n + 5 operations, how would you write that in Big-O, and why?",
                "Big-O keeps only the fastest-growing term and drops constant factors, so 3n + 5 operations is O(n)",
            ),
            (
                "loop_example",
                "One loop over n items is O(n); a nested loop over the same items is O(n^2).",
                [
                    "o(n)",
                    "linear",
                    "nested loop",
                    "n squared",
                    "o(n^2)",
                    "o(n2)",
                    "each item once",
                    "loop inside",
                ],
                "How much work does one loop over n items do, and how does that change when a second loop runs inside it?",
                "A loop that visits each of n items once does O(n) work; a loop inside another loop over the same n items does O(n^2) work",
            ),
        ],
        errors=[
            (
                "exact_time",
                "Big-O gives the exact running time in seconds.",
                ["exact time", "in seconds", "exactly how long", "how many seconds"],
            )
        ],
    ),
    "dsa.complexity_classes": dict(
        name="Complexity classes and case analysis",
        description="Comparing O(1), O(log n), O(n), O(n log n), O(n^2); best and worst case",
        notes="From slowest growth to fastest growth the common classes are O(1), O(log n), O(n), O(n log n) and O(n^2). O(1) means the work does not depend on n. O(log n) appears when each step halves the remaining problem, as in binary search. The best case is the input that makes the algorithm do the least work and the worst case is the input that makes it do the most. For linear search the best case is O(1), when the target is first, and the worst case is O(n), when the target is last or missing.",
        question="Put these classes in order from slowest to fastest growth: O(n^2), O(1), O(n log n), O(log n), O(n). Then explain best case and worst case using linear search.",
        answer="From slowest to fastest growth: O(1), O(log n), O(n), O(n log n), O(n^2). The best case is the input that needs the least work and the worst case the input that needs the most. In linear search the best case is O(1), when the target is the first item, and the worst case is O(n), when it is last or missing.",
        points=[
            (
                "order",
                "Orders the classes O(1), O(log n), O(n), O(n log n), O(n^2).",
                ["constant", "logarithmic", "o(1)", "o(log n)", "n log n", "slowest", "fastest"],
                "Which of these classes grows most slowly as n increases, and which grows fastest?",
                "From slowest growth to fastest growth the common classes are O(1), O(log n), O(n), O(n log n) and O(n^2)",
            ),
            (
                "cases",
                "The best case is the input with the least work; the worst case is the input with the most work.",
                [
                    "best case",
                    "worst case",
                    "least work",
                    "most work",
                    "fewest steps",
                    "most steps",
                ],
                "What do we mean by the best case and the worst case of an algorithm?",
                "The best case is the input that makes the algorithm do the least work and the worst case is the input that makes it do the most",
            ),
            (
                "linear_search",
                "Linear search: best case O(1) when the target is first; worst case O(n) when it is last or missing.",
                [
                    "first element",
                    "target is first",
                    "first item",
                    "last element",
                    "last item",
                    "not in the list",
                    "missing",
                    "not found",
                ],
                "For linear search, which input makes it finish fastest, and which makes it slowest?",
                "For linear search the best case is O(1), when the target is first, and the worst case is O(n), when the target is last or missing",
            ),
        ],
        errors=[
            (
                "log_slower",
                "O(log n) grows faster than O(n).",
                ["log n is slower than n", "log n is worse than n", "log n grows faster than n"],
            )
        ],
    ),
    "dsa.array_costs": dict(
        name="Array operation costs",
        description="Why array access is constant time but insertion and deletion are linear",
        notes="Array elements sit next to each other in memory, so the address of element i is computed directly from the start address and i. That makes access by index O(1). Inserting or deleting in the middle means shifting every later element one place, so in the worst case it takes O(n) time.",
        question="Why can an array read any element by its index in constant time, but needs linear time to insert an element at the front?",
        answer="Array elements are stored next to each other in memory, so the address of element i is computed directly from the start address and the index: access is O(1). Inserting at the front means shifting every existing element one place to the right, which takes O(n) time.",
        points=[
            (
                "contiguous",
                "Elements are stored next to each other, so the address of element i is computed directly: O(1) access.",
                [
                    "next to each other",
                    "contiguous",
                    "consecutive",
                    "address",
                    "calculate",
                    "directly",
                    "constant time",
                    "o(1)",
                ],
                "How does the computer find element i of an array without looking at the elements before it?",
                "Array elements sit next to each other in memory, so the address of element i is computed directly from the start address and i",
            ),
            (
                "shifting",
                "Inserting or deleting shifts the later elements, so it is O(n) in the worst case.",
                [
                    "shift",
                    "move every",
                    "move the other",
                    "make space",
                    "make room",
                    "linear",
                    "o(n)",
                ],
                "What has to happen to the existing elements when you insert a new element at the front of an array?",
                "Inserting or deleting in the middle means shifting every later element one place, so in the worst case it takes O(n) time",
            ),
        ],
        errors=[
            (
                "search_access",
                "Reading by index needs a search through the array.",
                [
                    "search through the array",
                    "loop to find the index",
                    "check each element until",
                    "go through every element to reach",
                ],
            )
        ],
    ),
    "dsa.linked_list": dict(
        name="Linked lists",
        description="Nodes and pointers; traversal, insertion and deletion by pointer reassignment",
        notes="Each node stores a value and a pointer to the next node, and the list keeps a pointer to the first node, called the head. To reach an item you must traverse from the head, following one pointer at a time, so access by position is O(n). Once you hold the node before the insertion point, inserting or deleting only reassigns pointers, so no elements are shifted.",
        question="How is a linked list built from nodes, and how do you insert a new node after a given node?",
        answer="Each node holds a value and a pointer to the next node, and the list keeps a head pointer to the first node. To insert after a given node, point the new node to that node's next node, then point the given node to the new node. Only pointers change; nothing is shifted. Reaching a position still needs traversal from the head, which is O(n).",
        points=[
            (
                "nodes",
                "A node stores a value and a pointer to the next node; the head points to the first node.",
                ["node", "pointer", "next", "reference", "head", "link"],
                "What does each node in a linked list store?",
                "Each node stores a value and a pointer to the next node, and the list keeps a pointer to the first node, called the head",
            ),
            (
                "insert",
                "Insertion only reassigns pointers; no elements are shifted.",
                [
                    "change the pointer",
                    "reassign",
                    "point to the new node",
                    "update the next",
                    "no shifting",
                    "relink",
                    "change the links",
                ],
                "When you add a node after a given node, what do you change, and what stays where it is?",
                "inserting or deleting only reassigns pointers, so no elements are shifted",
            ),
            (
                "traverse",
                "Reaching a position needs traversal from the head: O(n).",
                [
                    "traverse",
                    "from the head",
                    "follow the pointers",
                    "one by one",
                    "walk through",
                    "o(n)",
                ],
                "How do you reach the fifth node of a linked list, and how does that cost grow with the list length?",
                "To reach an item you must traverse from the head, following one pointer at a time, so access by position is O(n)",
            ),
        ],
        errors=[
            (
                "direct_access",
                "A linked list reaches any position directly in O(1), like an array index.",
                [
                    "access any node directly",
                    "jump to the position",
                    "like an array index",
                    "go straight to the node",
                ],
            )
        ],
    ),
    "dsa.stack": dict(
        name="Stacks",
        description="LIFO ordering; push, pop and peek; applications such as bracket matching and undo",
        notes="A stack is last in, first out: the item added most recently is the first one removed. Push adds an item to the top, pop removes the top item, and peek reads the top item without removing it. In bracket matching, each opening bracket is pushed and each closing bracket must match the bracket popped from the top. Undo works the same way: the most recent action is reversed first.",
        question="Explain how a stack decides which item to remove next, and show how a stack checks whether the brackets in ( [ ] ) are balanced.",
        answer="A stack is last in, first out: the most recently pushed item is popped first. Push adds to the top, pop removes the top and peek reads it. For ( [ ] ): push '(', push '[', then ']' matches the '[' popped from the top, and ')' matches the '(' popped next. The stack ends empty, so the brackets are balanced.",
        points=[
            (
                "lifo",
                "Last in, first out: the most recently added item is removed first.",
                [
                    "lifo",
                    "last in first out",
                    "last in, first out",
                    "last-in, first-out",
                    "most recent",
                    "last added",
                    "latest item",
                    "top item",
                ],
                "If you push A and then B, which one comes out first, and why?",
                "A stack is last in, first out: the item added most recently is the first one removed",
            ),
            (
                "operations",
                "Push adds to the top, pop removes the top, peek reads the top.",
                ["push", "pop", "peek", "top"],
                "Which stack operations change the stack, and which one only looks at it?",
                "Push adds an item to the top, pop removes the top item, and peek reads the top item without removing it",
            ),
            (
                "brackets",
                "Bracket matching pushes each opening bracket; each closing bracket must match the popped top.",
                [
                    "push the opening",
                    "opening bracket",
                    "closing bracket",
                    "pop",
                    "match",
                    "empty at the end",
                    "balanced",
                ],
                "In bracket matching, what do you do when you read a closing bracket?",
                "each opening bracket is pushed and each closing bracket must match the bracket popped from the top",
            ),
        ],
        errors=[
            (
                "fifo",
                "A stack removes the oldest item first (first in, first out).",
                [
                    "stack is fifo",
                    "stack follows fifo",
                    "first in first out",
                    "oldest first",
                    "removes the first item added",
                ],
            )
        ],
    ),
    "dsa.queue": dict(
        name="Queues",
        description="FIFO ordering; enqueue and dequeue; applications such as scheduling",
        notes="A queue is first in, first out: the item that has waited longest leaves first. Enqueue adds an item at the rear and dequeue removes the item at the front. Schedulers use queues so that tasks are served in the order they arrive, for example print jobs or customer requests.",
        question="How does a queue differ from a stack, and why is a queue a good choice for a printer's list of jobs?",
        answer="A queue is first in, first out: enqueue adds at the rear and dequeue removes from the front, so the item that waited longest leaves first. A stack removes the newest item first. A printer should print jobs in the order they arrive, so a queue keeps the order fair.",
        points=[
            (
                "fifo",
                "First in, first out: the item that has waited longest leaves first.",
                [
                    "fifo",
                    "first in first out",
                    "first in, first out",
                    "first-in, first-out",
                    "waited longest",
                    "first come first served",
                    "oldest first",
                    "arrived first",
                ],
                "If job A arrives before job B, which leaves the queue first?",
                "A queue is first in, first out: the item that has waited longest leaves first",
            ),
            (
                "ends",
                "Enqueue adds at the rear; dequeue removes from the front.",
                ["enqueue", "dequeue", "rear", "back", "front"],
                "At which end does a queue add items, and at which end does it remove them?",
                "Enqueue adds an item at the rear and dequeue removes the item at the front",
            ),
            (
                "scheduling",
                "Scheduling with a queue serves tasks in arrival order, such as print jobs.",
                [
                    "order they arrive",
                    "arrival order",
                    "in order",
                    "fair",
                    "printer",
                    "scheduling",
                    "print jobs",
                ],
                "Why does serving tasks with a queue keep a printer fair to its users?",
                "Schedulers use queues so that tasks are served in the order they arrive, for example print jobs or customer requests",
            ),
        ],
        errors=[
            (
                "lifo",
                "A queue removes the newest item first (last in, first out).",
                ["queue is lifo", "last in first out", "newest first", "most recent first"],
            )
        ],
    ),
    "dsa.call_stack": dict(
        name="The call stack",
        description="How the runtime tracks active function calls as a stack of frames",
        notes="Each time a function is called, the runtime pushes a frame holding that call's parameters, local variables and return address. When the function returns, its frame is popped and execution continues where the caller left off. The frame on top always belongs to the function that is running now.",
        question="What happens on the call stack when main calls f, and f calls g? Describe what is pushed and what is popped.",
        answer="Each call pushes a frame with the call's parameters, local variables and return address: first main, then f, then g on top. g runs because its frame is on top. When g returns, its frame is popped and f continues where it left off; when f returns, its frame is popped and main continues.",
        points=[
            (
                "frames",
                "Each call pushes a frame holding its parameters, local variables and return address.",
                ["frame", "push", "parameters", "local variables", "return address"],
                "What does the runtime store when a function is called?",
                "Each time a function is called, the runtime pushes a frame holding that call's parameters, local variables and return address",
            ),
            (
                "returns",
                "Returning pops the frame and the caller continues where it left off.",
                ["pop", "returns", "back to the caller", "continues", "removed", "left off"],
                "What happens to g's frame when g returns, and which function runs next?",
                "When the function returns, its frame is popped and execution continues where the caller left off",
            ),
            (
                "top",
                "The frame on top belongs to the function running now.",
                ["top", "currently running", "running now", "g is on top", "active"],
                "While g is running, where is its frame on the stack?",
                "The frame on top always belongs to the function that is running now",
            ),
        ],
        errors=[
            (
                "first_finishes_first",
                "The first function called finishes first.",
                ["main finishes first", "first called finishes first", "f finishes before g"],
            )
        ],
    ),
    "dsa.recursion_cases": dict(
        name="Base case and recursive case",
        description="Stopping condition and reducing a problem to a smaller instance of itself",
        notes="A recursive function has a base case that answers a small input directly without calling itself, and a recursive case that calls itself on a smaller input. For factorial, factorial(0) = 1 is the base case and factorial(n) = n * factorial(n - 1) is the recursive case. Without a base case, or if the input never gets smaller, the calls never stop.",
        question="What are the base case and the recursive case in a recursive function? Use factorial as your example.",
        answer="The base case answers a small input directly without recursion; the recursive case calls the function on a smaller input. For factorial, factorial(0) = 1 is the base case and factorial(n) = n * factorial(n - 1) is the recursive case. Without a base case, or if n never gets smaller, the calls never stop.",
        points=[
            (
                "base_case",
                "The base case answers a small input directly, without calling itself.",
                [
                    "base case",
                    "stopping condition",
                    "stops",
                    "without calling itself",
                    "factorial(0)",
                    "returns 1",
                ],
                "How does a recursive function know when to stop calling itself?",
                "a base case that answers a small input directly without calling itself",
            ),
            (
                "recursive_case",
                "The recursive case calls the function on a smaller input.",
                [
                    "recursive case",
                    "calls itself",
                    "smaller",
                    "n - 1",
                    "n-1",
                    "n minus 1",
                    "smaller problem",
                    "reduce",
                ],
                "In factorial(n), what smaller problem does the function solve to get its answer?",
                "a recursive case that calls itself on a smaller input",
            ),
            (
                "termination",
                "Without a base case, or without a smaller input, the calls never stop.",
                ["never stop", "infinite", "stack overflow", "forever", "never end"],
                "What goes wrong if a recursive function has no base case?",
                "Without a base case, or if the input never gets smaller, the calls never stop",
            ),
        ],
        errors=[
            (
                "optional_base",
                "A recursive function does not need a base case.",
                [
                    "base case is optional",
                    "do not need a base case",
                    "don't need a base case",
                    "no need for a base case",
                ],
            )
        ],
    ),
    "dsa.recursion_tracing": dict(
        name="Tracing recursion",
        description="Following recursive calls frame by frame; call depth and stack overflow",
        notes="To trace sum(3), where sum(n) = n + sum(n - 1) and sum(0) = 0, write one frame per call: sum(3), sum(2), sum(1), sum(0). The calls go down until the base case, then the results return back up: 0, 1, 3 and finally 6. The call depth is the number of frames active at once. Each frame uses stack memory, so a very deep recursion runs out of stack space and causes a stack overflow.",
        question="Trace sum(3), where sum(n) = n + sum(n - 1) and sum(0) = 0. What is the call depth, and what is a stack overflow?",
        answer="sum(3) calls sum(2), which calls sum(1), which calls sum(0). sum(0) returns 0, then the results return back up: sum(1) = 1, sum(2) = 3, sum(3) = 6. Four frames are active at the deepest point, so the call depth is 4. Each frame uses stack memory, so a very deep recursion runs out of stack space: that is a stack overflow.",
        points=[
            (
                "calls_down",
                "The calls go down sum(3), sum(2), sum(1), sum(0).",
                ["sum(2)", "sum(1)", "sum(0)", "calls sum", "goes down", "until the base case"],
                "Which calls are made, in order, before any of them returns?",
                "write one frame per call: sum(3), sum(2), sum(1), sum(0)",
            ),
            (
                "results_up",
                "The results return back up: 0, 1, 3 and finally 6.",
                ["returns 0", "back up", "then 3", "is 6", "equals 6", "returns 6", "answer is 6"],
                "Once sum(0) returns, how is the final answer built on the way back?",
                "the results return back up: 0, 1, 3 and finally 6",
            ),
            (
                "overflow",
                "Each frame uses stack memory; too deep a recursion causes a stack overflow.",
                [
                    "stack overflow",
                    "run out of",
                    "stack memory",
                    "too deep",
                    "too many frames",
                    "depth",
                ],
                "What limits how deep a recursion can go?",
                "Each frame uses stack memory, so a very deep recursion runs out of stack space and causes a stack overflow",
            ),
        ],
        errors=[
            (
                "one_frame",
                "All recursive calls share one frame.",
                ["share one frame", "same frame", "only one frame"],
            )
        ],
    ),
    "dsa.tree_traversal": dict(
        name="Tree structure and traversal",
        description="Root, leaf, height and subtree; in-order, pre-order and post-order traversal",
        notes="The root is the top node, a leaf has no children, every node with its descendants forms a subtree, and the height is the number of edges on the longest path from the root to a leaf. Pre-order visits the node, then its left subtree, then its right subtree. In-order visits the left subtree, then the node, then the right subtree. Post-order visits the left subtree, then the right subtree, then the node.",
        question="What are the root and the leaves of a tree? For a tree with root 2, left child 1 and right child 3, give the pre-order, in-order and post-order traversals.",
        answer="The root is the top node and a leaf is a node with no children. For root 2 with children 1 and 3: pre-order (node, left, right) is 2, 1, 3; in-order (left, node, right) is 1, 2, 3; post-order (left, right, node) is 1, 3, 2.",
        points=[
            (
                "root_leaf",
                "The root is the top node, and a leaf is a node with no children.",
                ["root", "top node", "leaf", "no children", "bottom nodes"],
                "How would you spot the root and the leaves in a tree drawing?",
                "The root is the top node, a leaf has no children",
            ),
            (
                "preorder",
                "Pre-order visits the node, then the left subtree, then the right subtree: 2, 1, 3.",
                ["pre order", "preorder", "node left right", "2 1 3", "2, 1, 3", "root first"],
                "In pre-order, when is the root visited compared with its children?",
                "Pre-order visits the node, then its left subtree, then its right subtree",
            ),
            (
                "inorder",
                "In-order visits the left subtree, then the node, then the right subtree: 1, 2, 3.",
                [
                    "in order",
                    "inorder",
                    "left node right",
                    "1 2 3",
                    "1, 2, 3",
                    "root in the middle",
                ],
                "In in-order, where does the root come between its two children?",
                "In-order visits the left subtree, then the node, then the right subtree",
            ),
            (
                "postorder",
                "Post-order visits the left subtree, then the right subtree, then the node: 1, 3, 2.",
                ["post order", "postorder", "left right node", "1 3 2", "1, 3, 2", "root last"],
                "In post-order, when is the root visited?",
                "Post-order visits the left subtree, then the right subtree, then the node",
            ),
        ],
        errors=[
            (
                "inorder_root_first",
                "In-order traversal visits the root first.",
                [
                    "in order visits the root first",
                    "inorder visits the root first",
                    "in order starts at the root",
                    "inorder starts with the root",
                ],
            )
        ],
    ),
    "dsa.bst": dict(
        name="Binary search trees",
        description="The BST invariant; search and insertion; degradation on sorted input",
        notes="In a binary search tree every key in a node's left subtree is smaller than the node's key and every key in its right subtree is larger. Search compares the target with the current node and goes left if it is smaller or right if it is larger, so a balanced tree is searched in O(log n). Insertion follows the same path and adds the new key as a leaf. Inserting keys in sorted order makes every node have only a right child, so the tree becomes a list and search degrades to O(n).",
        question="State the binary search tree rule, explain how you search for a key, and say what happens to the tree if you insert 1, 2, 3, 4, 5 in that order.",
        answer="In a BST every key in a node's left subtree is smaller and every key in its right subtree is larger. To search, compare the target with the node and go left if smaller or right if larger, which takes O(log n) in a balanced tree. Inserting 1, 2, 3, 4, 5 in sorted order gives each node only a right child, so the tree becomes a list and search degrades to O(n).",
        points=[
            (
                "invariant",
                "Keys in the left subtree are smaller; keys in the right subtree are larger.",
                [
                    "left is smaller",
                    "smaller on the left",
                    "right is larger",
                    "larger on the right",
                    "less than",
                    "greater than",
                    "bigger on the right",
                ],
                "Where must a key smaller than the root go in a binary search tree?",
                "every key in a node's left subtree is smaller than the node's key and every key in its right subtree is larger",
            ),
            (
                "search",
                "Search goes left if smaller and right if larger: O(log n) when balanced.",
                ["compare", "go left", "go right", "half", "o(log n)", "log n", "balanced"],
                "At each node, how does the search decide which way to go next?",
                "goes left if it is smaller or right if it is larger, so a balanced tree is searched in O(log n)",
            ),
            (
                "sorted_input",
                "Sorted insertion makes a chain of right children, so search becomes O(n).",
                [
                    "sorted",
                    "only right children",
                    "right child",
                    "like a list",
                    "linked list",
                    "chain",
                    "unbalanced",
                    "skewed",
                    "o(n)",
                ],
                "What shape does the tree take after inserting 1, 2, 3, 4, 5 in order, and how does that affect search?",
                "Inserting keys in sorted order makes every node have only a right child, so the tree becomes a list and search degrades to O(n)",
            ),
        ],
        errors=[
            (
                "always_log",
                "BST search is always O(log n), whatever the insertion order.",
                ["always log n", "always o(log n)", "never o(n)"],
            )
        ],
    ),
    "dsa.merge_sort": dict(
        name="Divide-and-conquer and merge sort",
        description="Divide, conquer, combine; merge sort and why it runs in O(n log n)",
        notes="Merge sort divides the list into two halves, sorts each half recursively, and then combines the two sorted halves by merging them. Merging two sorted lists repeatedly takes the smaller front item, so it takes linear time. Halving the list gives about log n levels of recursion, and each level does O(n) merging work, so merge sort runs in O(n log n).",
        question="Explain the divide, conquer and combine steps of merge sort, and why its running time is O(n log n).",
        answer="Merge sort divides the list into two halves, sorts each half recursively (conquer), and combines them by merging the two sorted halves, repeatedly taking the smaller front item. Halving gives about log n levels, and each level does O(n) merging work, so the total is O(n log n).",
        points=[
            (
                "steps",
                "Divide into two halves, sort each half recursively, combine by merging.",
                ["divide", "halves", "two halves", "recursively", "merge", "combine"],
                "What are the three stages that merge sort goes through?",
                "Merge sort divides the list into two halves, sorts each half recursively, and then combines the two sorted halves by merging them",
            ),
            (
                "merging",
                "Merging takes the smaller front item each time, in linear time.",
                ["smaller", "front", "compare the first", "linear", "o(n)"],
                "When merging two sorted lists, how do you choose the next item?",
                "Merging two sorted lists repeatedly takes the smaller front item, so it takes linear time",
            ),
            (
                "n_log_n",
                "About log n levels with O(n) work each gives O(n log n).",
                ["log n levels", "levels", "n log n", "each level"],
                "How many times can you halve a list of n items, and how much work happens at each level?",
                "Halving the list gives about log n levels of recursion, and each level does O(n) merging work, so merge sort runs in O(n log n)",
            ),
        ],
        errors=[
            (
                "quadratic",
                "Merge sort takes O(n^2) time.",
                ["merge sort is n squared", "merge sort is o(n^2)", "merge sort takes n squared"],
            )
        ],
    ),
    "prog.variables_types": dict(
        name="Variables and data types",
        description="Storing values in named variables; integers, floats, booleans and strings",
        notes='A variable is a name that refers to a stored value, and assigning a new value replaces the old one. The type of a value decides what it can hold and which operations make sense: an integer holds whole numbers, a float holds numbers with a fractional part, a boolean is True or False, and a string holds text. For example, 7 is an integer, 7.5 is a float and "7" is a string.',
        question="What is a variable? Then explain how an integer, a float, a boolean and a string differ, and give one example value.",
        answer='A variable is a named storage location for a value; assigning a new value replaces the old one. An integer holds whole numbers, a float holds numbers with a decimal (fractional) part, a boolean is True or False, and a string holds text in quotes. For example, 7 is an integer, 7.5 is a float and "7" is a string.',
        points=[
            (
                "variable",
                "A variable is a named storage location for a value, and assigning a new value replaces the old one.",
                [
                    "name",
                    "named",
                    "stores a value",
                    "stored value",
                    "holds a value",
                    "assign",
                    "storage",
                    "refers to",
                ],
                "What does a variable hold, and how does the program refer to it?",
                "A variable is a name that refers to a stored value, and assigning a new value replaces the old one",
            ),
            (
                "integer_float",
                "An integer holds whole numbers, and a float holds numbers with a fractional (decimal) part.",
                ["integer", "whole number", "float", "decimal", "fraction", "point"],
                "As data types, how is the number 7 different from the number 7.5?",
                "an integer holds whole numbers, a float holds numbers with a fractional part",
            ),
            (
                "boolean",
                "A boolean holds one of two values: True or False.",
                ["boolean", "true or false", "true and false", "two values", "yes or no"],
                "Which data type would you use to store whether a light is switched on?",
                "a boolean is True or False",
            ),
            (
                "string",
                "A string holds text (characters), written in quotes.",
                ["string", "text", "characters", "letters", "words", "in quotes"],
                "Which data type would hold someone's name, and how do you write its value?",
                "a string holds text",
            ),
            (
                "example",
                'Gives a correct example value with its type, such as 7 (integer), 7.5 (float) or "7" (string).',
                [
                    "7.5",
                    '"7"',
                    "for example",
                    "is an integer",
                    "is a float",
                    "is a string",
                    "is a boolean",
                ],
                "Give one value and say which of these types it has.",
                'For example, 7 is an integer, 7.5 is a float and "7" is a string',
            ),
        ],
        errors=[
            (
                "variable_is_type",
                "A variable is the same thing as a data type.",
                ["variable is a data type", "a variable is a type", "variable means data type"],
            ),
            (
                "text_number",
                'The string "7" and the number 7 are the same value.',
                ["same as the number 7", "string 7 is a number", "7 and 7 are the same"],
            ),
        ],
    ),
    "prog.operators_expressions": dict(
        name="Operators and expressions",
        description="Arithmetic, comparison and logical operators and how expressions evaluate",
        notes="Arithmetic operators such as +, -, * and / produce numbers, comparison operators such as <, == and != produce booleans, and logical operators and, or and not combine booleans. An expression is evaluated by precedence: multiplication and division happen before addition and subtraction, so 2 + 3 * 4 is 14, not 20. Comparison happens before logical operators, so x > 0 and x < 10 is true only when x is between 0 and 10.",
        question="What is 2 + 3 * 4, and why? Then explain what the expression x > 0 and x < 10 checks.",
        answer="2 + 3 * 4 is 14, because multiplication happens before addition (operator precedence): 3 * 4 = 12, plus 2 is 14. In x > 0 and x < 10, each comparison produces a boolean, True or False, and 'and' is true only when both are true, so it checks that x is between 0 and 10.",
        points=[
            (
                "precedence",
                "Multiplication happens before addition (operator precedence).",
                [
                    "precedence",
                    "multiplication first",
                    "multiply first",
                    "before addition",
                    "bodmas",
                    "bidmas",
                    "order of operations",
                ],
                "In 2 + 3 * 4, which operation is done first, and what is that rule called?",
                "multiplication and division happen before addition and subtraction",
            ),
            (
                "result",
                "2 + 3 * 4 evaluates to 14, not 20.",
                ["14", "fourteen"],
                "Work it out step by step: what is 3 * 4, and what do you get after adding 2?",
                "so 2 + 3 * 4 is 14, not 20",
            ),
            (
                "boolean_result",
                "A comparison such as x > 0 produces a boolean: True or False.",
                ["boolean", "true or false", "true", "false", "yes or no"],
                "If x is 5, what does x > 0 give you?",
                "comparison operators such as <, == and != produce booleans",
            ),
            (
                "and_both",
                "'and' is true only when both comparisons are true, so x > 0 and x < 10 checks that x is between 0 and 10.",
                [
                    "between 0 and 10",
                    "both true",
                    "both conditions",
                    "both",
                    "in the range",
                    "greater than 0 and less than 10",
                ],
                "If x is 15, is x > 0 and x < 10 true or false? Why?",
                "x > 0 and x < 10 is true only when x is between 0 and 10",
            ),
        ],
        errors=[
            (
                "left_to_right",
                "Expressions always run left to right, so 2 + 3 * 4 is 20.",
                ["is 20", "equals 20", "left to right", "add first"],
            )
        ],
    ),
    "prog.conditionals": dict(
        name="Conditionals",
        description="Branching with if, else-if and else based on boolean conditions",
        notes="An if statement runs its block only when its condition is true. In an if, else-if, else chain the conditions are checked from top to bottom, only the first true branch runs, and the else branch runs when no condition is true. For a mark of 72 with the chain if mark >= 75: A, else if mark >= 65: B, else: C, the result is B.",
        question="How does an if, else-if, else chain decide which branch to run? What grade does a mark of 72 get with: if mark >= 75 then A, else if mark >= 65 then B, else C?",
        answer="The conditions are checked from top to bottom and only the first true branch runs; else runs when no condition is true. For 72, mark >= 75 is false and mark >= 65 is true, so the result is B and the else branch is skipped.",
        points=[
            (
                "condition",
                "A branch runs only when its condition is true.",
                ["condition is true", "only if", "only when", "boolean condition", "if it is true"],
                "When does the block inside an if statement run?",
                "An if statement runs its block only when its condition is true",
            ),
            (
                "first_true",
                "Conditions are checked top to bottom; only the first true branch runs; else runs when none is true.",
                [
                    "top to bottom",
                    "in order",
                    "first true",
                    "only one branch",
                    "none of them",
                    "first condition that is true",
                ],
                "If two conditions in the chain are both true, which branches run?",
                "the conditions are checked from top to bottom, only the first true branch runs, and the else branch runs when no condition is true",
            ),
            (
                "example",
                "A mark of 72 gets B.",
                ["grade b", "gets b", "is b", "result is b", "would be b", "gets a b"],
                "Check 72 against each condition in turn. Which condition is the first one that is true?",
                "For a mark of 72 with the chain if mark >= 75: A, else if mark >= 65: B, else: C, the result is B",
            ),
        ],
        errors=[
            (
                "all_branches",
                "Every true branch in the chain runs.",
                [
                    "all true branches run",
                    "both branches run",
                    "runs every branch",
                    "every true branch runs",
                ],
            )
        ],
    ),
    "prog.loops": dict(
        name="Loops",
        description="Repeating work with for and while loops; loop conditions and termination",
        notes="A for loop repeats once for each item in a sequence or each value in a range, so the number of repetitions is known in advance. A while loop repeats as long as its condition stays true and checks the condition before each repetition. Every loop needs progress towards its stopping condition: a while loop whose condition never becomes false is an infinite loop.",
        question="When would you use a for loop and when a while loop? What makes a while loop stop, and what happens if it never does?",
        answer="A for loop repeats once for each item or each value in a range, when the number of repetitions is known in advance. A while loop repeats as long as its condition is true, checked before each repetition, when you do not know in advance how many times. It stops when the condition becomes false; if the body never makes progress towards that, it is an infinite loop.",
        points=[
            (
                "for_loop",
                "A for loop repeats for each item or value, so the count is known in advance.",
                [
                    "for each",
                    "each item",
                    "range",
                    "known number",
                    "fixed number",
                    "know how many times",
                ],
                "What decides how many times a for loop runs?",
                "A for loop repeats once for each item in a sequence or each value in a range, so the number of repetitions is known in advance",
            ),
            (
                "while_loop",
                "A while loop repeats while its condition is true, checked before each repetition.",
                [
                    "as long as",
                    "condition is true",
                    "until the condition",
                    "checks the condition",
                    "before each",
                    "while the condition",
                ],
                "When does a while loop check its condition, and what makes it stop?",
                "A while loop repeats as long as its condition stays true and checks the condition before each repetition",
            ),
            (
                "infinite",
                "Without progress towards the stopping condition, the loop never ends.",
                ["infinite loop", "never stops", "never ends", "forever", "never becomes false"],
                "What goes wrong if nothing in a while loop's body changes its condition?",
                "a while loop whose condition never becomes false is an infinite loop",
            ),
        ],
        errors=[
            (
                "runs_once",
                "A while loop always runs at least once.",
                [
                    "always runs at least once",
                    "runs once before checking",
                    "checks the condition after",
                ],
            )
        ],
    ),
    "prog.nested_loops": dict(
        name="Nested loops",
        description="Loops inside loops and how the total number of iterations multiplies",
        notes="For each single iteration of the outer loop, the inner loop runs completely from start to finish. The total number of inner iterations is the outer count multiplied by the inner count, so an outer loop of 3 and an inner loop of 4 run the inner body 12 times. Printing a multiplication table or comparing every pair of items uses nested loops, and over n items this gives n * n steps.",
        question="An outer loop runs 3 times and its inner loop runs 4 times. How many times does the inner body run, and why? Where would you use nested loops?",
        answer="The inner loop runs completely for each single iteration of the outer loop, so the counts multiply: 3 * 4 = 12. Nested loops are used for a multiplication table or for comparing every pair of items; over n items that is n * n steps.",
        points=[
            (
                "inner_completes",
                "The inner loop runs completely for each iteration of the outer loop.",
                [
                    "for each",
                    "every time the outer",
                    "runs completely",
                    "full inner loop",
                    "starts again",
                    "restarts",
                ],
                "What does the inner loop do during one iteration of the outer loop?",
                "For each single iteration of the outer loop, the inner loop runs completely from start to finish",
            ),
            (
                "multiply",
                "The total is the outer count times the inner count: 12.",
                ["12", "twelve", "multiply", "3 times 4", "3 x 4"],
                "How do you work out the total number of inner iterations from the two loop counts?",
                "The total number of inner iterations is the outer count multiplied by the inner count",
            ),
            (
                "uses",
                "Used for multiplication tables or comparing every pair; n items give n * n steps.",
                ["table", "every pair", "pairs", "grid", "n squared", "n times n", "matrix"],
                "Give a task that needs every item compared with every other item. How many steps does it take for n items?",
                "Printing a multiplication table or comparing every pair of items uses nested loops, and over n items this gives n * n steps",
            ),
        ],
        errors=[
            (
                "adds_counts",
                "The loop counts add: 3 + 4 = 7 iterations.",
                ["7 times", "seven times", "3 plus 4", "add the counts"],
            )
        ],
    ),
    "prog.functions": dict(
        name="Functions and parameters",
        description="Defining and calling functions; passing arguments to parameters",
        notes="A function definition gives a name to a block of code and lists its parameters, and the code runs only when the function is called. When you call a function, each argument value is passed to the matching parameter, so in def area(w, h) called as area(3, 4), w is 3 and h is 4. Functions let you reuse code and give a task a clear name.",
        question="What is the difference between defining and calling a function? In def area(w, h), what are w and h when you call area(3, 4)?",
        answer="Defining a function gives a named block of code with parameters; the code runs only when the function is called. Calling it passes each argument to the matching parameter, so area(3, 4) sets w to 3 and h to 4. Functions let you reuse code and give a task a clear name.",
        points=[
            (
                "define_call",
                "A definition names the code and lists parameters; the code runs only when called.",
                [
                    "define",
                    "definition",
                    "call",
                    "runs only when",
                    "when it is called",
                    "named block",
                ],
                "Does the code inside a function run when the function is defined? When does it run?",
                "A function definition gives a name to a block of code and lists its parameters, and the code runs only when the function is called",
            ),
            (
                "arguments",
                "Each argument goes to the matching parameter: w is 3 and h is 4.",
                ["argument", "parameter", "w is 3", "h is 4", "passed", "matching", "in order"],
                "When you call area(3, 4), which parameter receives 3, and how is that decided?",
                "each argument value is passed to the matching parameter, so in def area(w, h) called as area(3, 4), w is 3 and h is 4",
            ),
            (
                "reuse",
                "Functions let you reuse code and name a task clearly.",
                [
                    "reuse",
                    "reusable",
                    "clear name",
                    "organise",
                    "organize",
                    "avoid repeating",
                    "repeat the code",
                ],
                "Why write a function instead of copying the same lines in three places?",
                "Functions let you reuse code and give a task a clear name",
            ),
        ],
        errors=[
            (
                "runs_when_defined",
                "A function's code runs when the function is defined.",
                ["runs when defined", "runs when it is defined", "defining runs the code"],
            )
        ],
    ),
    "prog.return_values_scope": dict(
        name="Return values and scope",
        description="Returning results from functions; local versus outer variable scope",
        notes="A return statement ends the function and sends a value back to the caller, which can store or use it; printing a value only shows it and does not return it. A variable created inside a function is local: it exists only while that call runs and cannot be used outside the function. A local variable with the same name as an outer variable hides the outer one inside the function but does not change it.",
        question="What is the difference between returning a value and printing it? If a function creates a variable called total, can code outside the function use total?",
        answer="return ends the function and sends a value back to the caller, which can store or use it; print only displays it. A variable created inside a function is local: it exists only during that call and cannot be used outside. A local variable with the same name as an outer one hides it inside the function but does not change it.",
        points=[
            (
                "return",
                "return sends a value back to the caller; printing only shows it.",
                [
                    "return",
                    "back to the caller",
                    "sends back",
                    "can store",
                    "use the result",
                    "only shows",
                    "only displays",
                ],
                "After a function prints a number, can the caller store that number in a variable? What would let it?",
                "A return statement ends the function and sends a value back to the caller, which can store or use it",
            ),
            (
                "local",
                "A variable created inside a function is local and cannot be used outside.",
                [
                    "local",
                    "inside the function",
                    "only exists",
                    "cannot be used outside",
                    "not accessible",
                    "scope",
                ],
                "Where can a variable created inside a function be used, and when does it stop existing?",
                "A variable created inside a function is local: it exists only while that call runs and cannot be used outside the function",
            ),
            (
                "shadowing",
                "A local variable with an outer variable's name hides it but does not change it.",
                ["same name", "hides", "shadow", "does not change", "outer variable", "global"],
                "If the function sets its own total = 0 while an outer total is 50, what is the outer total afterwards?",
                "A local variable with the same name as an outer variable hides the outer one inside the function but does not change it",
            ),
        ],
        errors=[
            (
                "print_returns",
                "Printing a value returns it to the caller.",
                ["print returns", "printing returns", "print sends it back"],
            )
        ],
    ),
    "prog.call_flow": dict(
        name="Function call flow",
        description="Functions calling other functions and the order in which calls start and finish",
        notes="When one function calls another, the caller pauses at that line and waits until the called function finishes. If main calls a, and a calls b, the calls start in the order main, a, b, and they finish in the reverse order: b, then a, then main. After each call finishes, the caller resumes from the line after the call, using any returned value.",
        question="main calls a, and a calls b. In what order do the three functions start, and in what order do they finish? What does a do while b is running?",
        answer="They start in the order main, a, b and finish in reverse: b, then a, then main. While b runs, a is paused at the line that called b, waiting; when b finishes, a resumes from the line after the call, using any returned value.",
        points=[
            (
                "pause",
                "The caller pauses and waits until the called function finishes.",
                ["pauses", "waits", "stops at that line", "waiting", "on hold"],
                "What is function a doing while b is running?",
                "the caller pauses at that line and waits until the called function finishes",
            ),
            (
                "order",
                "Calls start main, a, b and finish b, a, main.",
                [
                    "b finishes first",
                    "reverse order",
                    "b then a",
                    "b, then a",
                    "main, a, b",
                    "last called finishes first",
                ],
                "Which of the three functions finishes first, and which finishes last?",
                "the calls start in the order main, a, b, and they finish in the reverse order: b, then a, then main",
            ),
            (
                "resume",
                "The caller resumes from the line after the call, using any returned value.",
                ["resumes", "continues", "line after", "returned value", "carries on"],
                "When b finishes, where does execution continue?",
                "After each call finishes, the caller resumes from the line after the call, using any returned value",
            ),
        ],
        errors=[
            (
                "caller_first",
                "The caller finishes before the functions it calls.",
                ["main finishes first", "main ends before a", "a finishes before b"],
            )
        ],
    ),
    "prog.lists_indexing": dict(
        name="Lists and indexing",
        description="Ordered collections accessed by index; reading and updating elements",
        notes="A list keeps items in order, and each item has an index that starts at 0, so the first item is at index 0 and the last is at index length - 1. You read an item with its index, as in scores[2] for the third item, and update it by assigning to that index, as in scores[2] = 90. Using an index equal to the length or larger is out of range and causes an error.",
        question="In scores = [70, 85, 60, 95], what is scores[2], how do you change it to 90, and what happens with scores[4]?",
        answer="Indexes start at 0, so scores[2] is 60, the third item. Assigning scores[2] = 90 updates it. The list has length 4, so the last index is 3; scores[4] is out of range and causes an error.",
        points=[
            (
                "zero_based",
                "Indexes start at 0, so scores[2] is the third item, 60; the last index is length - 1.",
                ["starts at 0", "start from 0", "zero", "index 0", "60", "third item"],
                "What index does the first item in a list have?",
                "each item has an index that starts at 0, so the first item is at index 0 and the last is at index length - 1",
            ),
            (
                "update",
                "You update an item by assigning to its index: scores[2] = 90.",
                ["scores[2] = 90", "assign", "90", "update", "replace", "set it"],
                "How do you replace one item in a list without changing the others?",
                "update it by assigning to that index, as in scores[2] = 90",
            ),
            (
                "out_of_range",
                "An index equal to the length or larger is out of range and causes an error.",
                ["out of range", "error", "index error", "does not exist", "no index 4", "outside"],
                "The list has four items. Which indexes are valid?",
                "Using an index equal to the length or larger is out of range and causes an error",
            ),
        ],
        errors=[
            (
                "one_based",
                "List indexes start at 1.",
                [
                    "starts at 1",
                    "start from 1",
                    "index 1 is the first",
                    "first item is at index 1",
                    "is 85",
                ],
            )
        ],
    ),
    "prog.collection_iteration": dict(
        name="Iterating over collections",
        description="Visiting every element of a collection with a loop",
        notes="A for loop can visit every element of a collection in order, as in for score in scores, without managing an index. To total a list, start a running total at 0 before the loop and add each element inside the loop. Use an index-based loop when you also need each element's position, for example for i in range(len(scores)).",
        question="How would you use a loop to add up all the values in a list? When would you loop with an index instead of over the items directly?",
        answer="Start a running total at 0 before the loop, then loop over the list (for score in scores) and add each element to the total; after the loop the total holds the sum. Loop with an index, such as for i in range(len(scores)), when you also need each element's position.",
        points=[
            (
                "visit",
                "A for loop visits every element in order without managing an index.",
                [
                    "for each",
                    "every element",
                    "for score in",
                    "each item",
                    "go through",
                    "in order",
                ],
                "How can a loop visit each item of a list without you tracking a position?",
                "A for loop can visit every element of a collection in order, as in for score in scores, without managing an index",
            ),
            (
                "running_total",
                "Start a running total at 0 before the loop and add each element inside it.",
                [
                    "total = 0",
                    "start at 0",
                    "running total",
                    "add each",
                    "sum",
                    "accumulate",
                    "before the loop",
                ],
                "Where do you create the total, and what do you do with it on each pass?",
                "start a running total at 0 before the loop and add each element inside the loop",
            ),
            (
                "with_index",
                "Use an index-based loop when you need each element's position.",
                ["range(len", "index", "position", "i in range"],
                "If you need to print each score together with its position, how would your loop change?",
                "Use an index-based loop when you also need each element's position",
            ),
        ],
        errors=[
            (
                "reset_inside",
                "The running total should be set to 0 inside the loop.",
                ["total = 0 inside the loop", "reset the total each time", "set total to 0 inside"],
            )
        ],
    ),
    "prog.references_mutability": dict(
        name="References and mutability",
        description="Variables referring to objects; mutating shared data through a reference",
        notes="A variable refers to an object rather than holding its own copy, so after b = a both names refer to the same list. A mutable object such as a list can be changed in place, and the change is visible through every name that refers to it: after b = a and b.append(4), a also shows 4. To get an independent list, make a copy, for example b = a.copy().",
        question="If a = [1, 2, 3], then b = a, then b.append(4), what does a contain? Explain why, and how you would make b independent.",
        answer="a contains [1, 2, 3, 4]. b = a does not copy the list; both names refer to the same list object. Lists are mutable and append changes the object in place, so the change is visible through a as well. To make b independent, copy the list: b = a.copy().",
        points=[
            (
                "same_object",
                "After b = a, both names refer to the same list; nothing is copied.",
                [
                    "same list",
                    "same object",
                    "refer to the same",
                    "not a copy",
                    "point to the same",
                    "reference",
                ],
                "After b = a, how many list objects exist?",
                "after b = a both names refer to the same list",
            ),
            (
                "mutation",
                "Changing the list in place shows through every name, so a also shows 4.",
                [
                    "a also changes",
                    "a has 4",
                    "both change",
                    "mutable",
                    "in place",
                    "a also shows 4",
                ],
                "Why does the change made through b also appear when you print a?",
                "the change is visible through every name that refers to it: after b = a and b.append(4), a also shows 4",
            ),
            (
                "copy",
                "Copying, for example b = a.copy(), makes an independent list.",
                ["copy", ".copy()", "list(a)", "a[:]", "new list", "independent", "slice"],
                "How could you give b its own list so that changing b leaves a alone?",
                "To get an independent list, make a copy, for example b = a.copy()",
            ),
        ],
        errors=[
            (
                "assignment_copies",
                "b = a makes a separate copy, so a is unchanged.",
                [
                    "a does not change",
                    "b is a copy",
                    "separate copy",
                    "a is unchanged",
                    "a stays the same",
                ],
            )
        ],
    ),
    "prog.code_tracing": dict(
        name="Tracing program execution",
        description="Following code line by line and recording variable state at each step",
        notes="To trace a program, follow it one line at a time in the order it runs and write down every variable's value after each step, usually in a trace table. For total = 0 followed by for i in range(1, 4): total = total + i, the trace gives total = 1, then 3, then 6, so the final value is 6. Tracing helps you find where the actual values differ from the values you expected.",
        question="Trace this code and give the value of total after each loop pass: total = 0, then for i in range(1, 4): total = total + i. How does tracing help with debugging?",
        answer="range(1, 4) gives i = 1, 2, 3. total starts at 0, becomes 1 after the first pass, 3 after the second and 6 after the third, so the final value is 6. Tracing records each variable's value step by step, so you can see where the actual values differ from what you expected, which locates the bug.",
        points=[
            (
                "method",
                "Follow the code line by line and record every variable after each step, often in a trace table.",
                [
                    "line by line",
                    "one line at a time",
                    "trace table",
                    "write down",
                    "record",
                    "each step",
                ],
                "What do you write down while tracing a program, and when?",
                "follow it one line at a time in the order it runs and write down every variable's value after each step",
            ),
            (
                "values",
                "total becomes 1, then 3, then 6; the final value is 6.",
                [
                    "1 3 6",
                    "1, 3, 6",
                    "1, 3 and 6",
                    "becomes 3",
                    "becomes 6",
                    "final value is 6",
                    "total is 6",
                    "ends at 6",
                ],
                "What is total after the first pass, when i is 1? And after the next pass?",
                "the trace gives total = 1, then 3, then 6, so the final value is 6",
            ),
            (
                "debugging",
                "Tracing shows where the actual values differ from the expected ones.",
                ["find the bug", "debug", "where it goes wrong", "differ", "expected", "mistake"],
                "How does a trace table help you find a mistake in a program?",
                "Tracing helps you find where the actual values differ from the values you expected",
            ),
        ],
        errors=[
            (
                "range_inclusive",
                "range(1, 4) includes 4, so total is 10.",
                ["includes 4", "total is 10", "up to 4 inclusive", "i is 4"],
            )
        ],
    ),
}


def follow_ups(concept):
    """The same five state-specific follow-ups the demo seed uses."""
    return {
        "partial": f"Please complete your explanation of {concept}; address any part of the original question you have not yet explained.",
        "superficial": f"Explain why {concept} works this way, using a concrete example.",
        "incorrect": f"Let us take one step at a time. What is the basic purpose of {concept}? Explain the rule in your own words.",
        "misconception_bearing": f"Check your proposed rule for {concept} against a small example. What result do you expect, and why?",
        "non_answer": f"In your own words, what do you understand about {concept}? You may use a short example.",
    }


def build():
    """Courses with their material and approved questions, ready to insert."""
    result = []
    for key, code, topic, concept_ids in COURSES:
        course_id = f"c3-{key}"
        material_id = f"{course_id}-notes"
        source = f"C3 {code} {topic} notes.md"
        chunks, questions = [], []
        for n, concept_id in enumerate(concept_ids, 1):
            c = CONCEPTS[concept_id]
            chunk = {
                "chunk_id": f"{material_id}:{n}",
                "source": source,
                "page": None,
                "text": f"{c['name']}. {c['description']}. {c['notes']}",
            }
            chunks.append(chunk)
            item = {
                "id": f"{course_id}-{n:02d}",
                "topic_id": course_id,
                "concept": c["name"],
                "question": c["question"],
                "reference_answer": c["answer"],
                "rubric_points": [
                    {
                        "id": pid,
                        "point": point,
                        "keywords": keywords,
                        "probe": probe,
                        "source_indices": [0],
                        "evidence_quote": quote,
                    }
                    for pid, point, keywords, probe, quote in c["points"]
                ],
                "misconceptions": [
                    {"id": mid, "description": text, "keywords": keywords}
                    for mid, text, keywords in c["errors"]
                ],
                "follow_ups": follow_ups(c["name"]),
                "sources": [dict(chunk)],
                "status": "approved",
                "origin": ORIGIN,
                "review_notes": REVIEW_NOTES,
                "version": 1,
            }
            questions.append(BankQuestion.model_validate(item).model_dump())
        text = "\n\n".join(c["text"] for c in chunks)
        result.append(
            {
                "course": {
                    "id": course_id,
                    "name": f"{topic} ({code})",
                    "description": f"From the C3 catalogue, {code} {MODULES[code]}: "
                    + "; ".join(CONCEPTS[i]["name"] for i in concept_ids)
                    + ".",
                },
                "material": {
                    "id": material_id,
                    "name": source,
                    "digest": hashlib.sha256(text.encode()).hexdigest(),
                    "chunks": chunks,
                },
                "questions": questions,
            }
        )
    return result


def replace_bank(db):
    """Clear every session, participant, course and question, then load the C3 bank.

    Staff users stay so nobody is signed out. One transaction: nothing changes on error.
    Returns the number of rows removed per table and the number added."""
    participants = select(User.id).where(User.role == "participant")
    staff = db.scalar(select(User).where(User.role == "admin").order_by(User.id))
    if staff is None:
        raise RuntimeError("Sign in once as admin first: courses need an admin as their creator.")
    removed = {}
    for label, statement in (
        ("human_ratings", delete(HumanRating)),
        ("integration_events", delete(IntegrationEvent)),
        ("viva_results", delete(Result)),
        ("viva_turns", delete(Turn)),
        ("viva_sessions", delete(VivaSession)),
        ("generated_question_bank", delete(Bank)),
        ("course_materials", delete(Material)),
        ("courses", delete(Course)),
        ("participant_tokens", delete(Token).where(Token.user_id.in_(participants))),
        ("participants", delete(User).where(User.role == "participant")),
    ):
        removed[label] = db.execute(statement.execution_options(synchronize_session=False)).rowcount
    added = {"courses": 0, "materials": 0, "questions": 0}
    for entry in build():
        db.add(Course(**entry["course"], created_by=staff.id))
        db.add(Material(course_id=entry["course"]["id"], **entry["material"]))
        added["courses"] += 1
        added["materials"] += 1
        for q in entry["questions"]:
            db.add(Bank(id=q["id"], topic_id=q["topic_id"], status=q["status"], data=q))
            added["questions"] += 1
    db.commit()
    return removed, added


def update_bank(db):
    """Refresh the C3 courses, materials and questions in place.

    Sessions, people and ratings stay; sessions keep the question snapshot they started with.
    A changed question gets the next version number. Returns how many rows were refreshed."""
    staff = db.scalar(select(User).where(User.role == "admin").order_by(User.id))
    counts = {"courses": 0, "materials": 0, "questions": 0}
    for entry in build():
        c, m = entry["course"], entry["material"]
        course = db.get(Course, c["id"])
        if course is None:
            if staff is None:
                raise RuntimeError("Sign in once as admin first: new courses need a creator.")
            db.add(Course(**c, created_by=staff.id))
        else:
            course.name, course.description = c["name"], c["description"]
        material = db.get(Material, m["id"])
        if material is None:
            db.add(Material(course_id=c["id"], **m))
        else:
            material.name, material.digest, material.chunks = m["name"], m["digest"], m["chunks"]
        for q in entry["questions"]:
            bank = db.get(Bank, q["id"])
            if bank is None:
                db.add(Bank(id=q["id"], topic_id=q["topic_id"], status=q["status"], data=q))
            elif {**bank.data, "version": 0} != {**q, "version": 0}:
                bank.data = {**q, "version": bank.data.get("version", 1) + 1}
                bank.status = q["status"]
            else:
                continue
            counts["questions"] += 1
        counts["courses"] += 1
        counts["materials"] += 1
    db.commit()
    return counts
