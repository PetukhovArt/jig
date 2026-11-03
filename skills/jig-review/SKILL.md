---
name: jig-review
description: "Review a diff with finders, a separate judge and proven findings. Mode review: someone else's merge request, threads, --post, re-review. Mode pre-mr: your own diff before the merge request, a verdict in four buckets."
argument-hint: "[pre-mr] [<merge request URL or number>] [quick|full|<selector>] [--layout <name>] [--post] [--no-state] [<focus note>]"
---

# jig-review

Plugin root: `${CLAUDE_PLUGIN_ROOT}` when the agent sets it, otherwise the directory two levels above this file; below, `<root>` means this path and `<skill>` means `<root>/skills/jig-review`. CLI: `node "<root>/bin/jig.mjs" <command>`. Atoms: `<root>/atoms/<name>.md`. Role templates: `<root>/skills/jig/references/roles/<name>.md`. Forge commands (`glab`, `gh`): `<root>/skills/jig/references/forge.md`, only when a merge request is involved.

## Start here

1. Read `<skill>/steps/01-prepare.md` and nothing else of the skill yet.
2. Its last section runs `jig review-plan`. The output ends with **the steps for this run**: absolute paths, in order, each with the part that applies. Read each when you reach it. A step file it does not list does not apply to this run: do not open it.

## Modes

- **`review`** (default): someone else's merge request, or a branch you were asked to review. With a merge request, findings become threads, a state file remembers them, and the next run re-reviews only the new work and checks the outcome of every open thread. Without one (a bare branch): the findings are printed, no state, no threads.
- **`pre-mr`** (first argument `pre-mr`): your own diff, before you open the merge request. A verdict in four buckets instead of threads. No state file, no posting, no outcome check, no re-review after your fixes: track progress in your todo list. You fix only **Act on**; **Consider** goes to the user as a question; Noted and Dismissed are listed. Then the caller continues: cleanup, then the merge request.

**State only where it outlives the session.** The state file (`.jig/runs/review/*.json` under the main checkout, shared by its linked worktrees) exists to carry threads across sessions; `jig review-cycle` reads it to skip a merge request whose head was already reviewed. It is read and written only in mode `review` with a known merge request and without `--no-state`; pass `--mr` to `jig review-plan` then. Everywhere else no file under `.jig/runs/review/` is read or written: the diff parts, the flow index and the flow model of the run go to the OS temp dir (`<tmp>/jig-review/diff-<hash>/`), as `jig review-plan` prints them.

## Arguments

- `pre-mr`: the mode above. Without it the mode is `review`.
- Merge request URL or number: the review target (mode `review`). None: the current branch.
- Selector: `full` (every angle), `quick` (only what blocks a merge), or comma-separated tokens (`important,spec`, `auto`). No selector: `full`.
- `--layout <auto|lean|solo>`: who hunts and who judges ([paths](#paths)); passed to `jig review-plan`. Vocabulary: `<skill>/references/selector.md`, only when the argument is not `full` or `quick`.
- `--post`: post the findings right after the review, without asking (mode `review` with a merge request only).
- `--no-state`: do not read or write state: always a first run, no outcome check, no learnings, no posting. Diagnostic mode.
- Any other text after these: the focus note (step 01).

Needs on `PATH`: `git`, `node`; with a merge request also the forge CLI of the repository.

## Paths

One path for every diff size; `auto` is `lean`:

- **Lean**: a flow-modeler subagent writes the [flow model](steps/04-flow-model.md); the diff's files split into `N` partitions (`N = ceil(LINES / 150)`, 1 to 5), and each partition gets a fresh `behavior` finder (bugs, state, contracts, efficiency, spec; deep/high), plus a `conventions` finder (standard/high) only when the project adds angles of that kind. You judge every candidate; one deep judge subagent on another model takes only the `Important` ones.

**A review with finders runs in a review runner.** `jig review-plan` prints `runner:` on every run that has something to review. In the session that asked for the review (not a review runner already: a review cycle's, or one spawned here), stop after the plan and spawn **one** subagent, described `Review !<iid>` (`Review <branch>` without a merge request), role `review-runner` (`<root>/skills/jig/references/roles/review-runner.md`, deep tier), with: the repository path, the target, the mode, the focus note, this `SKILL.md` path, and `delegated: <the review-plan command you ran>`. It runs the review from step 01, spawns the finders fresh, and returns the survivors and the state path. Then you do what needs the user: the [posting](references/posting.md) confirmation in mode `review`, the four buckets in mode `pre-mr`. Its `head: moved …` line means the author pushed while it ran: re-review the increment (the state now holds the reviewed sha, so a new run plans only the new commits) before offering to post. Your session stays at its size.

The other layout, by `--layout solo`, `JIG_REVIEW_LAYOUT` or the project config: the same partitions and finders, and every finder proves its own candidates; no judge subagents. `inline` and `fanout` are gone: the flow model and the partition finders replaced the session's own hunt.

## Rules for the whole run

- **At most `maxParallel` subagents at once** (6 by default, printed by `jig review-plan`): finders, deepening, judges, composers together. A slot frees, the next one in the queue starts.
- **Every subagent gets its tier and effort explicitly**, never the session's model: from `jig review-plan` for finders and judges, from its role template for the rest. `jig tiers` maps a tier to models; `~/.jig/config.jsonc` (key `tiers`) overrides the model list.
- **A spawn's description is `<Role> <detail> !<iid>`**: the role word first (`Finder`, `Judge`, `Deepener`, `Outcome check`), the merge request number with `!`, e.g. `Finder bugs-1 !12`. `jig review cost` attributes the subagent's spend by it; without a merge request, `<Role> <detail>`.
- **Subagents only read.** Every brief says that edits and commits are forbidden.
- **A review never runs tests**, builds or installs dependencies, you included: a claim only a test would settle is not proven (a candidate is `REFUTED: not proven`, an outcome stays `unverified`).
- **Briefs give paths, not text.** A subagent reads the skill files it needs itself: the brief names their absolute paths as `jig review-plan` prints them (angle files, atoms, gate files, role template). Paste only what is not a file: the diff command, candidates, facts and decisions, the project's severity sections.
- **Subagents run in the foreground and report to you only.** Several spawns in one message run in parallel. A background subagent may deliver its report to the session at the top (a review cycle, which must never act on findings) and keeps running after you fail. Never `sleep`, never read a subagent's output file in a loop: every such turn re-sends the whole context.
- **Read shared context once** ([finders](steps/04-finders.md#shared-context)): the flow model and the diff index; each finder reads its own partition's diff parts.
- **Finders are spawned fresh, never forked**, with the tier and effort `jig review-plan` printed: a fork inherits the spawner's effort, and a partition finder needs nothing of its context.
- **The review hunts what the user meets, not the shape of code.** Duplication, naming, style, layers, comments and tests belong to the project's checks, not to a reviewer ([angles](angles/00-index.md)). A project that still wants one of them reviewed adds its own angle of kind `conventions`; its rules count only with a quoted line of the project's document, and a rule its tooling enforces is not a finding.
- **Editing this skill** (steps, angles, gates, tiers, briefs) passes the eval on reference merge requests (`<skill>/references/eval.md`) before it merges.
