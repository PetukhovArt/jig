---
name: custom-flow
description: "no flow fits, or the work is large and cross-cutting: frame it, design its workflow, run each unit as an experiment, leave a decision trail."
---
# custom-flow

**You own the workflow. Design it before any code, run it as experiments, leave a trail a human can audit after stepping away.**

Atoms: prove-shippable, small-steps, design-it-twice, shared-state, do-less, lessons-to-checks.

1. Frame. Ground first (the how step of `flows/investigation.md`), then state: done as a predicate that can pass or fail; the scale in numbers (units, call sites, files, effort) and the blockers grounding found; the rigor, biased high: a one-way door or a wide blast radius gets more gates and artifacts, a reversible low-stakes step gets fewer. Rigor is gates and artifacts, not effort.
2. A run of hours: present the frame and its trade-offs in your reply and wait for the go (hitl). afk: continue and report it.
3. Design the workflow. Atomic units that each land on their own; the riskiest unknown first. Build the verification harness before the work and capture its baseline from the current state, so every check reads "old value, new value". A one-way-door design goes through `flows/module-design.md`; mechanical work whose shape is settled does not. Fan out only across seams, each worker in its own worktree (atom shared-state). Write the phase list down: it is what the human reviews. Add its units to the todo list between this step and step 5.
4. Run each unit as an experiment: the hypothesis, the smallest change, a measurement against the predicate on the real artifact, keep or revert. The verdict is VERIFIED, NOT VERIFIED or INCONCLUSIVE; inconclusive is not a pass, and a negative is reported. Pair delegated work with your review of its diff. A worker that games a gate: reset it and harden the brief. A wrong gate: fix the gate in its own change.
5. Keep the decision trail as each unit lands: one row per decision, kept or reverted, with `jig task-status log` (fields: `<root>/skills/jig-task-status/SKILL.md`).
6. Verify the whole against the predicate from step 1 on the real product, not only the harness. A correction you made twice becomes a check (atom lessons-to-checks).
7. Code changed: `flows/mr.md`. Otherwise `skip: no code changed`.

Reply: the workflow you designed, the rigor and why, the trail, what is verified against the predicate, what is still open.
