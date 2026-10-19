---
name: module-design
description: "ground, sketch two shapes in parallel, pick by depth, implement against the sketch."
---
# module-design

**You own the shape. Ground, sketch twice, implement against the sketch.**

Atoms: module-depth, design-it-twice, domain-model, system-edges, patterns, one-way, reader-cost.

1. Ground: the How mode of `flows/investigation.md` over every subsystem the new code touches. Naming a file is not grounding; grounding the calling flow already did counts, extend it instead of repeating it. If `stratum.config.jsonc` exists, read its layers and rules first: they are constraints. The design moves ownership or layering: also the Why mode on the current shape. `skip: greenfield` only when nothing exists to integrate with.
2. Sketch: run `references/coliseum.md` with the design-sketch task, role `module-sketcher` for the candidates and `referee` for the cross-judge, the grounding as input. At least two structurally different shapes, never two variants of one. Screen each against `references/module-red-flags.md`; pick by interface depth (`references/deep-modules.md`).
3. Agree: state the chosen shape in one line in your reply and continue with it. Stop and wait only when the user asked to see the design first. Pushback on the shape, now or later: it is grounding evidence; back to step 1, then rerun step 2 before writing more code.
4. Implement against the sketch: replace `not implemented` bodies with code. The sketch is the contract. A deviation (a parameter, a type or a module the sketch did not have) is a decision in the design record naming whether the sketch was wrong, a requirement was missed or the code overreaches; never absorb it silently. The jig gates then check types, ESLint and stratum.
5. Scrap: watch for a pattern, not one instance: the same workaround shape in unrelated places; unrelated edge cases each needing a special branch; escape hatches to compile (`any`, casts, optional fields always set); a lock for state the sketch called unshared; callers needing the module's internal rules; two or more deviations of one shape. Then throw the sketch out: subtract first (the new sketch is smaller than the old one before it grows), re-ground over what was built, redesign as if the new constraints were there from day one, rerun step 2. Complexity in the data is not complexity in the design.
6. Record: fill `references/module-design-record.md` next to the sketch. Its summary goes into your reply (with the record path) and into the Trade-offs section of the merge request description.

Reply: the chosen shape and its interface, the shapes that lost and why (a table), the referee's verdict and where you disagreed, grafts with their sources, deviations and scraps, the design record path.
