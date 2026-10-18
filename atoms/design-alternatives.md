---
name: design-alternatives
description: "Apply when facing a novel interface, data shape or architectural decision with no precedent in the codebase, or when a new requirement lands in an existing design. Get the data structures right first, explore two or three shapes, and redesign as if the requirement had been there from day one."
---
# Design alternatives

- Name the data shape before writing logic. When the data structure is right, the code around it becomes obvious.
- For a novel decision, sketch two or three structurally different options (types and signatures, not prose) and compare them side by side before committing.
- Write the caller's usage first; the interface follows from it.
- A new requirement: redesign as if it had been foundational, propagate it through every reference, then deliver the redesign in small steps.
- Prefer deepening a module that already exists over adding a new one.
- A decision you can settle by running something is settled by a prototype, not by debate.
- Record the losing options and why they lost, in one line each.
