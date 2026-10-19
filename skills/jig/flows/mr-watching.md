---
name: mr-watching
description: "drive your open merge requests through conflicts, threads and CI, and land a verified stack when the user says so."
---
# mr-watching

**You own the merge frontier. Clear one merge request at a time and stop where the human's call begins.**

Atoms: autonomy, evidence, small-steps, shared-state.

One pass per call. Recurrence is the user's `/loop`.

1. Discover your open merge requests via `glab`/`gh` (`references/forge.md`).
2. Filter: skip a request whose worktree is still busy from a previous pass, and one where no thread waits on you and the branch is up to date with its target.
3. For each remaining request: a worktree on its branch (`git worktree add`, then `jig worktree seed <dir>`).
4. Conflicts first: rebase or merge the target; resolve conflicts by intent, run the checks.
5. Threads next: spawn one subagent with role `fixer` per request. For each reviewer thread it decides fix, decline (with counter-evidence) or defer (with a proposed issue) and makes the fixes.
6. CI last: read the failing jobs; fix what the change broke; report what is infrastructure.
7. Push. Reply once per thread you handled: what changed and where, or the counter-evidence. Never resolve your own threads: that is the reviewer's call.
8. Remove every worktree you created in this pass.
9. Merge, only when the user asked for it in this session; otherwise `skip: no merge command`. Each request needs a verdict (pass or fail) from an agent that did not write its code and ran the change as a user would; green CI and a bot approval are not verdicts. Land only the contiguous verified run from the bottom of the stack: stop at the first request without a pass. Before trusting an older verdict, compare `git patch-id` at the verdict commit with the current head; a different patch needs a fresh verdict. Merge bottom-up, one at a time, and read the request back: merged, with the trunk as its base. Then retarget the next request to the trunk, move its patch onto the merge result, push with `--force-with-lease`, and wait for its checks. Nothing else writes to the stack while it lands. Stop at the first unverified request.

Reply: one line per merge request: what you did (rebased, fixed N threads, declined M, CI state, merged or waiting), what waits on a human.
