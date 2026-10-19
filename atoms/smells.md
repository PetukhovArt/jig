---
name: smells
description: "Apply when judging whether a hunk is a code smell. Each smell is a heuristic with a known fix, never a hard violation; report it as 'possible <smell>'."
metadata:
  group: Review
---
# Smells

- Mysterious name: rename it; if no honest name comes, the design is murky.
- Duplicated code: extract the shared shape, call it from both.
- Feature envy: move the method onto the data it reaches into.
- Data clumps: the same fields travel together; bundle them into one type.
- Primitive obsession: give the concept its own small type.
- Repeated switches on the same type: polymorphism, or one map both sites share.
- Shotgun surgery: one change forces scattered edits; gather what changes together.
- Divergent change: one module changes for unrelated reasons; split it.
- Speculative generality: abstractions for needs nobody has; inline them back.
- Message chains: hide the walk behind one method on the first object.
- Middle man: cut the delegate, call the target.
- Global or mutable data shared by unrelated code: wrap every write in one owner.
- A smell is reported with the fix it implies, not as a style remark.
