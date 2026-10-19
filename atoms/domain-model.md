---
name: domain-model
description: "Apply when writing stateful logic, designing types, or when code branches a lot on the same shape. Encode the domain in a structure (a union, a state machine, a registry) instead of scattered conditionals, and make illegal states unrepresentable."
metadata:
  group: Design
---
# Domain model

- The sign you skipped this: a feature that grows an if/else chain by one more branch.
- Fields meaningful only in some states become a discriminated union, one variant per state.
- If you can write a comment explaining when a combination of fields is valid, split it into a sum type.
- A model that carries only data while its rules live in outside functions is anemic: move the rule onto the data it guards. A DTO at a boundary is data by contract and stays plain.
- Validation of one model lives in its constructor or factory, not at every call site.
- Brand semantic primitives (ids, units, money) so they cannot be swapped.
- Exhaust every variant; an unhandled variant is a compile error, not a default branch.
