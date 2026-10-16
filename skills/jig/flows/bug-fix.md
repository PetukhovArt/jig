# bug-fix

**You own this task. Plan, review, verify.**

Atoms: root-causes, prove-it-works, blast-radius, tests.

1. Reproduce the bug yourself on the surface where the user sees it. Runtime-visible: drive the app (agent-view) and save the path as an act scenario. Otherwise: a failing test or a script. Build the loop so it goes red on the bug.
2. Understand the area first: the how and why steps of `flows/investigation.md`, as deep as the bug needs.
3. Minimise the reproduction, write hypotheses down, instrument instead of guessing, until you reach the first place the system went wrong.
4. Name the fact the fix is safe because of (atom blast-radius).
5. Fix it at the root. Fix every instance of the same mistake.
6. Re-run the same reproduction: red before, green after. A regression test only if it passes atom tests.
7. Update the feature's behaviour catalog and its act scenario when the project keeps them.
8. Runtime-visible change: run `flows/bug-bash.md` in final-step mode on your own diff. Otherwise `skip: not runtime-visible`.
9. `flows/mr.md`.

Reply: what was broken, the root cause with `file:line`, the fix, how you verified it. Paste the failing-then-passing reproduction output verbatim.
