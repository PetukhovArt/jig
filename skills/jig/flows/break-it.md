---
name: break-it
description: "attack a feature in the running app and report reproduced bugs (bug bash), one breaker subagent per screen or claim."
---
# break-it

**You own the attack, not the fix. A bug is reported only after it reproduced twice through the UI.**

Atoms: prove-shippable, evidence, autonomy, ux.

Modes: standalone on a merge request (yours or someone else's), or final-step mode from `flows/mr.md` on your own diff (steps 3 to 6 and 9 only, findings fixed in the calling flow instead of posted).

1. Platforms: list every platform the project ships the feature on and which you can launch here.
2. Claims: list what the change claims to do, from the description, the task and the diff.
3. Environment: no app control (SKILL.md): `skip: no app control` for steps 3 to 6, and the report says no attack ran. Otherwise run the branch under test where SKILL.md says (Where the app runs); start the app on its own runtime and, if needed, the backend; build your own test data sized to stress the feature.
4. Queue: list the screens the claims touch, each with the use cases from the behavior catalog that reach it. A claim with no screen of its own is its own entry.
5. Attack: spawn role `breaker` per queue entry, with the entry, its use cases, the runtime and port, the test data, the diff paths, atom `ux`, and the data sizes x1, x10, x100. One app instance serves one breaker at a time: run them one after another, or in parallel only on separate slots. You hold the queue and the tables, never drive the app yourself.
6. Triage: merge the breakers' tables, drop duplicates (same cause `file:line`), re-run one use case per important bug yourself to confirm it reproduces.
7. Post one thread per bug (standalone mode, when the user asked to post): severity and title, steps to reproduce, actual result, expected result, platforms, the use case name.
8. Teardown: stop every process you started by its ports and confirm the ports are free; the slot's own dev server stays. A tracked change left in the slot: stop and report.
9. Report.

Reply: a table of bugs (severity, title, platforms, use case, cause `file:line`), the claims you could not break, what you could not test and why.
