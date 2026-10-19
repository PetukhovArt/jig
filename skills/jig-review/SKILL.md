---
name: jig-review
description: "Review a diff with finders, a separate judge and proven findings. Mode review: someone else's merge request, threads, --post, re-review. Mode pre-mr: your own diff before the merge request, a verdict in four buckets."
argument-hint: "[pre-mr] [<merge request URL or number>] [quick|full|<selector>] [--post] [--no-state] [<focus note>]"
---

# jig-review

Plugin root: `${CLAUDE_PLUGIN_ROOT}`; below, `<root>` means this path and `<skill>` means `<root>/skills/jig-review`. CLI: `node <root>/bin/jig.mjs <command>`. Atoms: `<root>/atoms/<name>.md`. Role templates: `<root>/skills/jig/references/roles/<name>.md`. Forge commands (`glab`, `gh`): `<root>/skills/jig/references/forge.md`.

The skill is built from steps. Read each step file when you reach it, not before.

## Modes

- **`review`** (default): someone else's merge request, or a branch you were asked to review. Findings become threads; state remembers them, and the next run re-reviews only the new work and checks the outcome of every open thread.
- **`pre-mr`** (first argument `pre-mr`): your own diff, before you open the merge request. Same pipeline (steps 0–2 and 4–6), then a verdict in four buckets instead of threads ([output](steps/08-output.md#pre-mr-verdict)). No state, no posting, no outcome check, no re-review after your fixes. You fix only **Act on**; **Consider** goes to the user as a question; Noted and Dismissed are listed. Then the caller continues: cleanup, then the merge request.

## Arguments

- `pre-mr`: the mode above. Without it the mode is `review`.
- Merge request URL or number: the review target (mode `review`). None: the current branch.
- Selector: `full` (default, every angle), `quick` (only what blocks a merge), or comma-separated tokens (`important,architecture,tests`, `auto`). Vocabulary: [`references/selector.md`](references/selector.md).
- `--post`: post the findings right after the review, without asking (mode `review` only).
- `--no-state`: do not read or write state: always a first run, no outcome check, no learnings, no posting. Diagnostic mode. Mode `pre-mr` always runs like this.
- Any other text after these: the focus note ([step 01](steps/01-prepare.md#focus-note)).

Needs on `PATH`: `git`, `node`; in mode `review` also the forge CLI of the repository (`forge.md`).

## Steps

0. [Project config](references/project-config.md): optional `.jig/review.jsonc`: where to look and where to route. No file: the defaults there.
1. [Prepare](steps/01-prepare.md): target, base and diff, selector, focus, facts and decisions, spec, the layout from `jig review-plan`.
2. [Project rules](steps/02-rules.md): rule documents found by walking up from the diff, filtered, routed to angles.
3. [State](steps/03-state.md): mode `review` only. State, learnings, adopting your own threads. `--no-state` turns it off.
4. [Finders](steps/04-finders.md) → [angles](angles/00-index.md).
5. [Verify](steps/05-verify.md): dedup, verdict, gates, severity, on a different model than the finder.
6. [Rank](steps/06-rank.md): output order and filters.
7. [Comment texts](steps/07-comments.md): mode `review` only.
8. [State and output](steps/08-output.md): the review output, or the pre-mr verdict.

**Re-review** (mode `review`, state exists): [step 09](steps/09-rereview.md) replaces steps 4–6 for its scope: incremental diff, outcome check, replies in threads.

**Posting** (mode `review`, only with `--post` or an explicit request): [`references/posting.md`](references/posting.md). Unavailable with `--no-state`: the postable set comes from state.

## Rules for the whole run

- **At most `maxParallel` subagents at once** (6 by default, printed by `jig review-plan`): finders, deepening, judges, composers together. Each agent is a process, and a batch of 13 judges loads the machine. A slot frees, the next one in the queue starts. A spawn refused by the environment joins the same queue: [refused spawn](steps/04-finders.md#refused-spawn).
- **Every subagent gets its tier and effort explicitly**, never the session's model: from `jig review-plan` for finders, from its role template for the rest. `jig tiers` maps a tier to models; `~/.jig/config.jsonc` (key `tiers`) overrides the model list.
- **Subagents only read.** Every brief says that edits and commits are forbidden.
- **The convention boundary is the tooling, not the topic.** A rule the repository's linter, formatter or type checker enforces is not a finding. A rule from the project's review document that tooling does not enforce is a finding of [angle 10](angles/10.conventions.md), naming and style included. A convention without a quoted line of that document is not a finding.
- **Editing this skill** (steps, angles, gates, tiers, briefs) passes the [eval on reference merge requests](references/eval.md) before it merges.
