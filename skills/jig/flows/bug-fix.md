---
name: bug-fix
description: "reproduce, find the root cause, fix, prove."
---
# bug-fix

**You own this task. Loop first, cause second, fix last.**

Atoms: root-causes, prove-shippable, change-impact, tests.

Discipline for steps 1 to 4 and 7: `references/diagnosis.md`.

1. Feedback loop: build a tight loop that goes red on the bug, on the surface where the user sees it (diagnosis phase 1). Done when you have run one command that shows the user's exact symptom.
2. UI touched? The bug shows in the UI, or the fix will change files the user sees. Yes: `agent-view act list <section>`; reuse the feature's use case, or have agent-view's act-decider record the reproduction path and save it with `agent-view act save-use-case`. No: `skip: UI not touched`.
3. Understand the area: the how and why steps of `flows/investigation.md`, as deep as the bug needs.
4. Minimize, hypothesize, instrument (diagnosis phases 2 to 4) until you reach the first place the system went wrong.
5. The fix crosses a function boundary (a signature, an exported type or a module's public surface): `flows/module-design.md` first. Otherwise `skip: the fix stays inside one function`.
6. Name the fact the fix is safe because of (atom change-impact).
7. Fix it at the root, every instance of the same mistake. A fix that spans several modules goes to a delegate with a brief, as in `flows/feature.md` step 7; you review its diff. A regression test only when the bug has a cheap local test path and the test passes atom tests: write it before the fix, see it fail for the bug's reason, commit it before the fix. Otherwise `skip: <reason>`, the loop is the proof.
8. Rerun the same loop: red before, green after. Then clean up (diagnosis phase 6).
9. Update the feature's behavior catalog and its use case when the project keeps them.
10. Pre-MR stage: `flows/mr.md` (review in mode `pre-mr`, use case replay with screenshots and a bug-bash when UI is touched, `jig pre-mr`, the merge request).

Reply: what was broken, the root cause with `file:line` and the hypothesis that held, the fix, how you verified it. Paste the failing-then-passing loop output verbatim.
