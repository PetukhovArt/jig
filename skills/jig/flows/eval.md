---
name: eval
description: "measure how a change to an atom, flow or skill changes agent behavior before you keep it."
---
# eval

**You own the experiment design. Frame, blind, run, read every output, then decide.**

Atoms: writing-for-agents, docs, why-this-number, evidence.

Blinding holds for everything a candidate agent sees (directories, file names, the prompt): none of the words eval, test, judge, experiment, rubric, score, compare, benchmark, candidate, arena; project-shaped names a user would pick; no request to list the skills, atoms or files it applied; no hint that other runs exist.

1. Frame: the variant under test (the diff to the atom, flow or skill) and the behavior that counts as success. Write the rubric, 3 to 6 concrete criteria, for the judge only.
2. Case: an existing case under `<root>/evals/agent/` that exercises the behavior, or a new one next to them (`case.yaml`, `prompt.md`, `fixture/`, `graders/`, `scaffold.sh`). The prompt reads as an organic user request: the goal, not the meta.
3. Two plugin trees: the base and the variant, each in its own worktree.
4. Run both with `node <root>/evals/run-local.mjs --plugin <tree> --case <name> --runs <N> --out <dir>`, once per tree, on two or more models (`--model`, in the order `jig tiers` prints). Add `--arms with,without` when the question is whether the plugin helps at all.
5. Judge blind: the graders run on a model other than the candidates' (`--judge-model`) and see outputs by run label, never by model or variant. Base and variant are scored on one scale.
6. Grade chain-following from the traces (`<out>/traces/*.jsonl`): which files each run actually read and what code it produced. Never from the run's own claims.
7. Read every run's output yourself. Compare with the graders; a disagreement means a biased model or an ambiguous rubric, so look again before deciding.
8. Report the numbers with run count and spread (atom why-this-number). Keep the variant only when it beats the base beyond the noise without a regression on another case.

Reply: the variant, the rubric, the runs per tree and model, the scores with spread, per-run notes, the graders' verdict and where you disagreed, keep or drop with the reason, the results path.
