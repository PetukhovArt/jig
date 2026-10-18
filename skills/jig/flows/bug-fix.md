# bug-fix

**You own this task. Plan, review, verify.**

Atoms: root-causes, prove-shippable, change-impact, tests.

1. Reproduce the bug yourself on the surface where the user sees it. Runtime-visible: drive the app (agent-view) and save the path as an act scenario. Otherwise: a failing test or a script. Build the loop so it goes red on the bug.
2. Understand the area first: the how and why steps of `flows/investigation.md`, as deep as the bug needs.
3. Minimise the reproduction, write hypotheses down, instrument instead of guessing, until you reach the first place the system went wrong.
4. The fix crosses a function boundary (changes a signature, an exported type or a module's public surface): `flows/module-design.md` first. Otherwise `skip: the fix stays inside one function`.
5. Name the fact the fix is safe because of (atom change-impact).
6. Fix it at the root. Fix every instance of the same mistake.
7. Re-run the same reproduction: red before, green after. A regression test only when the bug has a cheap local test path and the test passes atom tests: write it before the fix, see it fail for the bug's reason, commit it before the fix. Expensive, integration-heavy or unclear: `skip: <reason>`, the reproduction is the proof. A unit test shows branch behavior, not that the bug is gone.
8. Update the feature's behaviour catalog and its act scenario when the project keeps them.
9. Runtime-visible change: run `flows/bug-bash.md` in final-step mode on your own diff. Otherwise `skip: not runtime-visible`.
10. `flows/mr.md`.

Reply: what was broken, the root cause with `file:line`, the fix, how you verified it. Paste the failing-then-passing reproduction output verbatim.
