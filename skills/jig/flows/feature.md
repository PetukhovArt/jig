---
name: feature
description: "build new behavior with the right data shape and prove it on the running product."
---
# feature

**You own the design. Plan, review, verify.**

Atoms: design-it-twice, domain-model, patterns, system-edges, do-less, effects, small-steps, change-impact, prove-shippable, typescript.

1. Understand the area: the how step of `flows/investigation.md`. Find what already exists to reuse (atom one-way).
2. Design the interface: `flows/module-design.md`, with step 1 as its grounding. A fork you can settle by running something goes to `flows/prototype.md`.
3. Name the fact the change is safe because of (atom change-impact).
4. Implement in small steps: each unit ends in a check you run before the next. Keep the type check tight while you work.
5. Verify on the surface the user uses. Runtime-visible: drive the app and save the use case as an act scenario.
6. Update the feature's behaviour catalog and its act scenario when the project keeps them.
7. Runtime-visible change: run `flows/bug-bash.md` in final-step mode on your own diff. Otherwise `skip: not runtime-visible`.
8. `flows/mr.md`.

Reply: what you built, what you chose and why (a table for design alternatives), how you verified it, open decisions.
