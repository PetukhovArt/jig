# Eval of a skill edit on reference merge requests

An edit of steps, angles, gates, tiers or briefs passes this run before it merges. Typos and broken links do not need it. An edit written for one merge request fits itself to it; the corpus shows what it broke on the others.

## Corpus

Two files with one shape, entries from both are run:

- [`../eval/corpus.json`](../eval/corpus.json): shipped with jig, built on its own eval fixtures;
- `<project>/.jig/review-corpus.json`: the project's own reference merge requests, when present.

Each entry:

- `id`: a unique name;
- `repo`: a clone path or remote, or `{ "scaffold": "<script>", "plugin": true }`: a script under the plugin root that builds the repository in an empty directory;
- `range`: `<base>..<head>` of the reviewed diff (refs or shas);
- `mode`: `review` or `pre-mr`;
- `mustFind`: `{ where, mechanism, severity }` items the run must find; `where` is `file:line`, a symbol, or `?`;
- `mustNotPost`: `{ where, mechanism, why }` items that must not reach a thread or Act on (refuting them or cutting them by a gate is fine);
- `source`: where the case comes from.

An entry with an unknown `repo` or `range` does not run; the report names it as incomplete.

**When to add.** The review missed a defect found later (a human thread, QA, production): a `mustFind` item. A thread went out and was false (the author refuted it, it was deleted as noise): a `mustNotPost` item. The entry lands in the same commit as the skill edit the case caused.

## Run

1. **Two versions.** A and B: the skill before and after the edit. The old one from `git worktree add <tmp>/old-jig-review <base commit>` of the jig repository, the new one from the working tree. Which is A and which B is drawn by lot per entry; only the orchestrator knows the mapping.
2. **The merge request tree.** Per entry: build the repository (`repo`), then a worktree at `<head>` with a branch whose upstream is a branch set to `<base>`, so the skill takes the base from `@{upstream}` and the diff equals the merge request diff. No head check, no posting.
3. **Launch.** One version per subagent, the same brief: "read `<version path>/skills/jig-review/SKILL.md` and follow it with `--no-state` (mode from the entry) in `<tmp>/eval-<id>`". The versions run one after the other, not in parallel: each holds up to `maxParallel` subagents itself, and the cap holds for the whole eval. Alternate the order from entry to entry.
4. **What was read.** From each subagent's transcript collect the paths of its file reads. A run that read skill files outside its own version does not count. The agent's self-report of what it read is not used.
5. **Judge.** One subagent per entry sees the entry and both outputs labelled A and B, without the version names. For each output it marks every `mustFind` item `found` or `missed`, every `mustNotPost` item `posted` or `not`, and marks findings outside the corpus `new`. A match is by mechanism, not by line number.
6. **Your own read.** The orchestrator reads both outputs and compares with the judge. A disagreement means the entry is ambiguous: sharpen it and run the entry again.

`evals/run-local.mjs` runs whole agent sessions; the eval flow can drive these runs with it once it accepts a corpus entry as a case.

## Decision

The edit does not merge when B missed a `mustFind` that A found, or posted a `mustNotPost` that A did not. `new` findings go to the operator: a real one joins the corpus, and so does a false one.

## Report

A table per entry: `id · mustFind A/B · mustNotPost A/B · new A/B · agents and tokens A/B`. Below: incomplete entries, runs that did not count by step 4, and the conclusion: merge or not, naming the entry that decided.
