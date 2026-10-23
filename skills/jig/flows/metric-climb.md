---
name: metric-climb
description: "improve one metric over many measured attempts until a stop predicate holds; a one-off slowness fix is perf."
---
# metric-climb

**You own the metric and the integrity of the experiment. Delegate the attempts, review them, keep only what the numbers prove.**

Atoms: why-this-number, prove-shippable, small-steps, shared-state, do-less.

One change, one measurement, keep or revert. Never stack untested changes; never claim a win from reading code.

1. Ground the workload: the how step of `flows/investigation.md` over the target. Name the workload dimensions that move the result (data size, history, state, concurrency) and pick a case that reproduces the user's complaint; none does: fix the reproduction first. Then fix the metric, the direction that counts as better, and a stop predicate that pairs a target with a minimum number of iterations ("at least 50% better than baseline and at least 10 iterations"). The user's numbers when given; otherwise propose them (atom questions).
2. Build the harness: one command that prints the metric as the median of N runs, with its error count and a count of the work done. Prove it is sensitive: contrasting workloads separate as expected and the target case shows the symptom. Then freeze it. Record the baseline and a green run of the regression suite before any change.
3. Log every attempt as a row with `jig task-status log` (fields: `<root>/skills/jig-task-status/SKILL.md`): hypothesis, change, before, after, delta, tests, kept or reverted. Read the log before each attempt.
4. Each hypothesis names a mechanism from step 1 ("defer X off the boot path because it blocks first paint"), not "try memoizing something". A speed metric orders hypotheses as `flows/perf.md` step 3 does.
5. Loop, one hypothesis per attempt: a delegate makes the change with a tight brief and you review its diff. Independent hypotheses run in parallel, each delegate in its own agent worktree. Measure before and after with the frozen harness and run the regression suite. Keep only a move past the noise with the suite green; otherwise revert in full. One commit per kept win, staging only the files it changed.
6. Push past the first plateau: after several rejects, change the category, combine near-misses, reread the source, try something more radical. Correctness and simplicity outrank the number: revert a win that breaks behavior, keep a simplification that holds the number.
7. Stop when the predicate holds, or when the remaining ideas cost more than they can win. Never relax the predicate to meet it; never stop while cheap untried hypotheses remain. Stuck: say so.
8. `flows/mr.md` with the kept commits in the order they landed.

Before the reply run `jig task-status open` in the session language: the page opens in the browser.

Reply: the metric and target, baseline to final with the percent delta and the run count, attempts run (kept and reverted), each kept win in one line, the log, the next idea you would try.
