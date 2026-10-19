---
name: afk-mode
description: "work unattended toward a checkable done condition, or turn a queue of tasks into a stack of merge requests the human lands."
---
# afk-mode

**You own the exit condition. Define done, then drive to it without stopping. You never own the landing.**

Atoms: autonomy, small-steps, prove-shippable, shared-state.

The afk stance of atom autonomy holds for the whole run. Progress: read `<root>/skills/jig-task-status/SKILL.md` and follow it for the whole run.

Mode: one task (default), or a queue of tasks delivered as a stack of merge requests.

1. Write the done condition as a check that can pass or fail (a command, a count, a replay). "Work on it for an hour" is not a condition. A queue: done is every item in the stack with its verdict, or parked with the reason.
2. Set the wake mechanism the user granted (for example `/loop` on that check), never a fixed duration.
3. Loop: the smallest change toward the condition, verify it, then commit it or revert it. Log every decision with `jig task-status log`, reverted attempts included.
4. A choice only the human can make: take your recommended default, continue, and log the question, the option taken and what the human could say instead.
5. Parallel workers each write in their own worktree (the agent's own, or `jig worktree seed <dir>` on a new one). UI checks run in a slot (`jig slot show <n> <branch>`), never where a worker writes.
6. A plateau is not a stop. Stop only when the condition holds, or when you are truly blocked; then write up why.
7. Queue mode, per item: a fresh delegate builds it through its flow up to the merge request. An item that depends on another branches from that item's branch, not from the trunk. You are the only writer of the stack's shape: you alone rebase or retarget a link; delegates push only their own branch and report its tip and intended parent. Each merge request targets its parent's branch and carries its verdict (pre-MR review and verification) in its description. Before landing starts, absorb trunk drift by rebasing the stack bottom-up. Never merge, never arm auto-merge: the human lands the stack (`flows/mr-watching.md`, merge step, on their command). One task: `skip: one task`.
8. At the end: one subagent with role `journal-auditor` compares the task-status log with `git log` and the diff, and lists claims without evidence.

Reply: the done condition, iterations run, what landed (commits, or the stack from root to tip with one verdict line per link), what was reverted or parked and why, each question with the default taken, the final state of the condition, the auditor's list, the task-status log path.
