# babysit

**You own the merge frontier. Clear one merge request at a time and stop where the human's call begins.**

Atoms: autonomy, evidence, verifiable-units.

One pass per call. Recurrence is the user's `/loop`.

1. Discover your open merge requests via `glab`/`gh` (`references/forge.md`).
2. Filter: skip a request whose slot is still busy from a previous pass, and one where no thread waits on you and the branch is up to date with its target.
3. For each remaining request: take a slot with the `jig-slots` skill on its branch.
4. Conflicts first: rebase or merge the target; resolve conflicts by intent, run the checks.
5. Threads next: spawn one subagent with role `fixer` per request. For each reviewer thread it decides fix, decline (with counter-evidence) or defer (with a proposed issue) and makes the fixes.
6. CI last: read the failing jobs; fix what the change broke; report what is infrastructure.
7. Push. Reply once per thread you handled: what changed and where, or the counter-evidence. Never resolve your own threads: that is the reviewer's call.
8. Teardown every slot you took.

Reply: one line per merge request: what you did (rebased, fixed N threads, declined M, CI state), what waits on a human.
