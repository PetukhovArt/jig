---
name: small-steps
description: "Apply to multi-step work and to how you stack commits and merge requests. Break the work into small units that each end in a verifiable state, check each before the next, and order delivery so the sequence proves itself to a reviewer."
---
# Small steps

- Each unit ends in a state you can check: a test goes green, a replay passes, a command prints the expected value.
- Check a unit as a before/after bracket: show the state before, make the change, show the state after.
- Do not start the next unit while the current one is red.
- Order commits as an argument: the failing reproduction, then the fix; the deletion, then the reshape.
- A large change is a series of small merge requests, each reviewable on its own. Big diffs lower the quality of both human and model review.
- A thin vertical slice that works end to end beats a complete horizontal layer that cannot be run yet.
