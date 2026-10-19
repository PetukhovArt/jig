---
name: do-less
description: "Apply when sizing a change, adding an option or abstraction, or sequencing an addition. Bias toward deletion and the smallest change that solves the problem; remove dead weight first, then build on the simpler base."
metadata:
  group: Design
---
# Do less

- The smallest change that solves the stated problem wins, unless the architecture requires more. Then the architecture wins, and you say so.
- Remove before you add: dead code, redundant validation, stub references first.
- An option, flag, parameter or config key that every caller sets to the same value is not an option: inline it.
- An extension point (interface, hook, generic) with one implementation and no second consumer in sight goes away.
- Error handling for a state the types make impossible goes away.
- Keep the knob when it varies per environment or deployment, or a second consumer is named in the spec or the diff.
- Consolidate a decision behind one source of truth. Fewer lines beat elegant boilerplate.
