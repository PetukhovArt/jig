---
name: jig-review
description: "Review a diff with finders, a separate judge and proven findings. Mode review: someone else's merge request, threads, --post, re-review. Mode pre-mr: your own diff before the merge request, a verdict in four buckets."
argument-hint: "[pre-mr] [<merge request URL or number>] [quick|full|<selector>] [--post] [--no-state] [<focus note>]"
---

# jig-review

Plugin root: `${CLAUDE_PLUGIN_ROOT}`; below, `<root>` means this path and `<skill>` means `<root>/skills/jig-review`. CLI: `node <root>/bin/jig.mjs <command>`. Atoms: `<root>/atoms/<name>.md`. Role templates: `<root>/skills/jig/references/roles/<name>.md`. Forge commands (`glab`, `gh`): `<root>/skills/jig/references/forge.md`, only when a merge request is involved.

## Start here

1. Read `<skill>/steps/01-prepare.md` and nothing else of the skill yet.
2. Its last section runs `jig review-plan`. The output ends with **the steps for this run**: absolute paths, in order, each with the part that applies. Read each when you reach it. A step file it does not list does not apply to this run: do not open it.

## Modes

- **`review`** (default): someone else's merge request, or a branch you were asked to review. With a merge request, findings become threads, a state file remembers them, and the next run re-reviews only the new work and checks the outcome of every open thread. Without one (a bare branch): the findings are printed, no state, no threads.
- **`pre-mr`** (first argument `pre-mr`): your own diff, before you open the merge request. A verdict in four buckets instead of threads. No state file, no posting, no outcome check, no re-review after your fixes: track progress in your todo list. You fix only **Act on**; **Consider** goes to the user as a question; Noted and Dismissed are listed. Then the caller continues: cleanup, then the merge request.

**State only where it outlives the session.** The state file (`.jig/runs/review/*.json` under the main checkout, shared by its linked worktrees) exists to carry threads across sessions; `jig review-cycle` reads it to skip a merge request whose head was already reviewed. It is read and written only in mode `review` with a known merge request and without `--no-state`; pass `--mr` to `jig review-plan` then. Everywhere else no file under `.jig/runs/review/` is read or written.

## Arguments

- `pre-mr`: the mode above. Without it the mode is `review`.
- Merge request URL or number: the review target (mode `review`). None: the current branch.
- Selector: `full` (every angle), `quick` (only what blocks a merge), or comma-separated tokens (`important,architecture,tests`, `auto`). No selector: `quick` when `jig review-plan` gives `N = 1`, `full` otherwise. Vocabulary: `<skill>/references/selector.md`, only when the argument is not `full` or `quick`.
- `--post`: post the findings right after the review, without asking (mode `review` with a merge request only).
- `--no-state`: do not read or write state: always a first run, no outcome check, no learnings, no posting. Diagnostic mode.
- Any other text after these: the focus note (step 01).

Needs on `PATH`: `git`, `node`; with a merge request also the forge CLI of the repository.

## Paths

- **Inline** (`N = 1`, a small diff): you hunt and judge in this session; one judge subagent on another model only when an `Important` candidate survives your gates.
- **Subagents** (`N > 1`): finder subagents, then judge subagents per cluster, on a different model than the finder.

## Rules for the whole run

- **At most `maxParallel` subagents at once** (6 by default, printed by `jig review-plan`): finders, deepening, judges, composers together. A slot frees, the next one in the queue starts.
- **Every subagent gets its tier and effort explicitly**, never the session's model: from `jig review-plan` for finders and judges, from its role template for the rest. `jig tiers` maps a tier to models; `~/.jig/config.jsonc` (key `tiers`) overrides the model list.
- **Subagents only read.** Every brief says that edits and commits are forbidden.
- **Briefs give paths, not text.** A subagent reads the skill files it needs itself: the brief names their absolute paths as `jig review-plan` prints them (angle files, atoms, gate files, role template). Paste only what is not a file: the diff command, candidates, facts and decisions, the project's severity sections.
- **No polling.** Wait for a subagent by its completion notification, or run it in the foreground. Never `sleep`, never read its output file in a loop: every such turn re-sends the whole context.
- **The convention boundary is the tooling, not the topic.** A rule the repository's linter, formatter or type checker enforces is not a finding. A rule from the project's review document that tooling does not enforce is a finding of angle 10, naming and style included. A convention without a quoted line of that document is not a finding.
- **Editing this skill** (steps, angles, gates, tiers, briefs) passes the eval on reference merge requests (`<skill>/references/eval.md`) before it merges.
