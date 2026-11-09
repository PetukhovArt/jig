---
name: domain-model
description: "Apply when writing stateful logic, designing types, naming a new field or term, or when code branches a lot on the same shape. Names from the nearest glossary; the domain in a structure (a union, a state machine, a registry), not scattered conditionals; illegal states unrepresentable."
metadata:
  group: Design
---
# Domain model

- The sign you skipped this: a feature that grows an if/else chain by one more branch.
- Before you name a new field, prop, type, event or label, find the glossary nearest to the files you change: `GLOSSARY.md` (or `*glossary*.md`) in their directory or one above, or the one a glossary map assigns to it. Take the name from it; a word on its `_Avoid_` / `Avoid:` line is wrong for that concept. Ticket wording is the user's language, not the code's. No glossary: nothing to do, ask nothing.
- The code next to the change names the same concept already (`node.props.enabled` two lines above): reuse that name.
- Fields meaningful only in some states become a discriminated union, one variant per state.
- If you can write a comment explaining when a combination of fields is valid, split it into a sum type.
- A model that carries only data while its rules live in outside functions is anemic: move the rule onto the data it guards. A DTO at a boundary is data by contract and stays plain.
- Validation of one model lives in its constructor or factory, not at every call site.
- Brand semantic primitives (ids, units, money) so they cannot be swapped.
- Exhaust every variant; an unhandled variant is a compile error, not a default branch.
