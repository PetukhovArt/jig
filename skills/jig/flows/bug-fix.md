---
name: bug-fix
description: "reproduce, find the root cause, fix, prove."
---
# bug-fix

**You own this task. Loop first, cause second, fix last.**

Atoms: root-causes, prove-shippable, change-impact, tests.

Discipline for steps 1 to 4 and 7: `references/diagnosis.md`.

1. Feedback loop: build a tight loop that goes red on the bug, on the surface where the user sees it (diagnosis phase 1). Done when you have run one command that shows the user's exact symptom.
2. UI touched? Your judgment of what the user will see: the bug shows in the UI, or the fix will change what the user sees. The answer does not depend on whether the app can run here: a changed color, font, label, layout or field the user sees is `ui` even when the proof will be tests only. Record it always: `jig ui scope ui "<why>"` or `jig ui scope none "<why>"`. Ui, app control available (SKILL.md): reuse the feature's use case from the behavior catalog, or record the reproduction path with the app control tool and add it to the catalog; the loop of step 1 and its rerun in step 8 drive the app on its runtime. Ui, no app control: `skip: no app control`, the loop runs through a test or a script. None: `skip: UI not touched`. A fix that changes what the user sees (layout, styles, components) builds and proves that part as `flows/ui.md`, the bug's own screenshot as its reference.
3. Understand the area: the how and why steps of `flows/investigation.md`, as deep as the bug needs.
4. Minimize, hypothesize, instrument (diagnosis phases 2 to 4) until you reach the first place the system went wrong.
5. The fix crosses a function boundary (a signature, an exported type or a module's public surface): `flows/module-design.md` first. Otherwise `skip: the fix stays inside one function`.
6. Name the fact the fix is safe because of (atom change-impact).
7. Fix it at the root, every instance of the same mistake. A fix that spans several modules goes to a delegate with a brief, as in `flows/feature.md` step 7; you review its diff. A regression test only when the bug has a cheap local test path and the test passes atom tests: write it before the fix, see it fail for the bug's reason, commit it before the fix. Otherwise `skip: <reason>`, the loop is the proof.
8. Rerun the same loop: red before, green after. Then clean up (diagnosis phase 6).
9. Update the feature's behavior catalog and its use case when the project keeps them.
10. Pre-MR stage: `flows/mr.md`. Always its review of your diff (`jig-review` in mode `pre-mr`) and cleanup. Only when the user asked for a merge request or the repo has a remote: the UI proof, `jig pre-mr`, commits on a branch and the merge request.

Reply: what was broken, the root cause with `file:line` and the hypothesis that held, the fix, how you verified it. Paste the failing-then-passing loop output verbatim.
