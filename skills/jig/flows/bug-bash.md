---
name: bug-bash
description: "attack a feature in the running app and report reproduced bugs."
---
# bug-bash

**You own the attack, not the fix. A bug is reported only after it reproduced twice through the UI.**

Atoms: prove-shippable, evidence, autonomy.

Modes: standalone on a merge request (yours or someone else's), or final-step mode from `flows/mr.md` on your own diff (steps 3 to 6 and 9 only, findings fixed in the calling flow instead of posted).

1. Platforms: list every platform the project ships the feature on and which you can launch here.
2. Claims: list what the change claims to do, from the description, the task and the diff.
3. Environment: agent-view not configured (SKILL.md): `skip: agent-view not configured` for steps 3 to 6, and the report says no attack ran. Configured: show the branch under test in a slot (`jig slot show <n> <branch>`, the `jig-slots` skill), never in the copy where an agent writes code; start the app on the runtime `agent-view.config.json` names and, if needed, the backend; build your own test data sized to stress the feature.
4. Path to the feature: replay the act scenarios that reach the feature screen; a missing or stale step is recorded anew with agent-view's act tooling.
5. Attack: UX (every control, empty and huge inputs, keyboard, undo), inputs (boundaries, wrong formats), network (slow, offline, errors), perceived performance (action to settled UI at x1, x10, x100 data).
6. Triage: reproduce each bug twice from a fresh open; save its click path as an act use case; find the cause `file:line`; outside the diff is pre-existing. Severity: important (data loss, crash or hang, a claim broken, user blocked or misled), nit, pre-existing.
7. Post one thread per bug (standalone mode, when the user asked to post): severity and title, steps to reproduce, actual result, expected result, platforms, the act use case name.
8. Teardown: stop every process you started by its ports and confirm the ports are free; the slot's own dev server stays. A tracked change left in the slot: stop and report.
9. Report.

Reply: a table of bugs (severity, title, platforms, act use case, cause `file:line`), the claims you could not break, what you could not test and why.
