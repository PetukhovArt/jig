---
name: reader-load
description: "Apply when shaping or reviewing code that is hard to trace. Count the layers between a question and its answer and the state a reader must hold; collapse one-caller wrappers and shrink mutable scope."
---
# Reader load

- Test: can a new reader answer "where does X come from?" and "what can change X?" in under 30 seconds?
- A function or module whose whole body delegates onward has no logic of its own: inline it into its consumer.
- An abstraction with exactly one consumer is a layer to remove, unless it is a seam (dependency injection, a test boundary, a package's public index).
- An early return moved into a one-call helper hides the flow it was meant to flatten.
- Narrow the scope of mutable state to the smallest block that needs it.
- A cut must lower the number of layers, branches or names a reader holds. If it does not, revert it.
- People hold about four things at once. Code that needs more is split until each part fits.
