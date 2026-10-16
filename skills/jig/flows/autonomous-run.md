# autonomous-run

**You own the exit condition. Define done, then drive to it without stopping.**

Atoms: autonomy, verifiable-units, prove-it-works, shared-state.

1. Write the done condition as a check that can pass or fail (a command, a count, a replay). "Work on it for an hour" is not a condition.
2. Set the wake mechanism the user granted (for example `/loop` on that check), never a fixed duration.
3. Loop: the smallest change toward the condition, verify it, then commit it or revert it. Record every decision in the dashboard, including reverted attempts.
4. Own discoveries made mid-run: a question goes to `dash ask` with a default; continue with the default.
5. Parallel work gets its own slot per worker (`jig-slots`).
6. A plateau is not a stop. Stop only when the condition holds, or when you are truly blocked; then write up why.
7. At the end: one subagent with role `journal-auditor` compares the dashboard with `git log` and the diff, and lists claims without evidence.

Reply: the done condition, iterations run, what landed (commits), what was reverted, the final state of the condition, the auditor's list, the dashboard path.
