# Coliseum

Several candidates attempt the same artifact in parallel; a referee scores them; you pick a base and graft the best parts of the others into it. Use it when one attempt would lock in the wrong shape. Add a todo per phase: Frame, Fan out, Cross-judge, Pick, Graft, Verify.

## 1. Frame

Every candidate gets the same prompt, so the prompt is the contract.

1. Name the artifact each candidate produces and the grounding it reads (paths).
2. Write the rubric: 3 to 6 concrete criteria a reader can score on this task. Only the referee and you see it; candidates see the task.
3. Give each candidate its own output location: a worktree slot (`jig-slots` skill) when it writes into the repository, else a temp directory `<tmp>/coliseum-<slug>/candidate-<n>/`. No two candidates share a location.
4. Pick the count: two by default, more when the task has more design directions worth covering.

## 2. Fan out

1. Read the role's tier line and the `jig tiers` mapping. Candidate n runs on model n of that tier's list, wrapping around.
2. A tier with one model (or no mapping): give each candidate a different direction instead (for example minimal interface, maximal flexibility, the common caller trivial, ports and adapters). A tier with several models: the same prompt for all.
3. Spawn every candidate in one message, in the background, each with the full role template, the task, the grounding paths and its own output location.
4. A candidate that returns nothing: continue with the rest and note the dropout. One left: you are designing alone; say so.

## 3. Cross-judge

After every candidate finishes, spawn one subagent with role `referee`. Prefer a model of its tier that wrote no candidate. Give it the rubric, `references/module-red-flags.md` and the candidates by location label. It runs while you read.

## 4. Pick

1. Read every candidate end to end yourself. Score each against the rubric, criterion by criterion, not by overall feel.
2. Compare with the referee. Agreement confirms the base. Disagreement: one of you is biased or the rubric was ambiguous; read both reasons and look at the candidates again before deciding.
3. The base is the one a future maintainer extends most easily without breaking its invariants. A tie goes to the smaller interface or the cleaner seam.

## 5. Graft

1. Walk each losing candidate once more for one or two parts worth porting.
2. Rewrite each graft into the base by hand so the result keeps one mental model. Never paste mechanically.
3. The candidates converged on one shape: that is consensus; take it, no graft needed. They diverged wildly: the Frame was under-specified; reframe and rerun, do not average.

## 6. Verify

Check the result like any other artifact (atom `prove-shippable`). A problem the coliseum missed: either the Frame was wrong (reframe and rerun) or a candidate caught it and the graft was missed (back to Graft).

Output: the artifact plus a note: the base and why, the referee's verdict, each graft with its source, what was rejected and why, convergence or dropouts, the verification result.
