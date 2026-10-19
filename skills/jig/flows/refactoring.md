---
name: refactoring
description: "change structure, keep behavior, prove equivalence."
---
# refactoring

**You own the contract. The structure changes. The behavior does not.**

Atoms: reader-cost, smells, do-less, one-way, dead-code, automate-repeats, patterns, domain-model, effects, change-impact, small-steps, prove-shippable.

1. Pin the behavior: an existing test, a characterization test, or an act replay that passes now.
2. Name the missing structure: what makes the code hard to change (atoms reader-cost, domain-model, patterns).
3. Name the target shape as types and module boundaries before moving code; crossing a function boundary → `flows/module-design.md`.
4. Subtract first: delete dead code, redundant layers and stub references.
5. Move in small green steps. Migrate callers and delete the old way in the same wave. Ten similar edits: write the codemod (atom automate-repeats).
6. Prove equivalence: the same pin passes, plus a type check and the project's tests on the touched area.
7. If reader cost did not drop, revert the step.
8. `flows/mr.md`.

Reply: the structure that changed, the pin you held it against, the equivalence proof, the reader-cost change (layers, names, files), what shipped and what you reverted. No new behavior.
