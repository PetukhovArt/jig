# Prepare

## Project config

`.jig/review.jsonc` exists: read [`../references/project-config.md`](../references/project-config.md) first; it decides what to search next and which ceilings apply. No file: the defaults apply and you need not read that reference (`jig review-plan` prints `config: default`).

## Target

- Mode `review`, a merge request URL or number: review its source branch; fetch and check it out when needed.
- Mode `review`, no argument: the current branch.
- Mode `pre-mr`: the current branch with its uncommitted changes.

Mode `review` with a merge request URL or number, or when asked to post: resolve the merge request ("Merge request of the current branch" in `forge.md`); it keys the state. A branch with no merge request named: no forge call, no state.

## Base and diff

`@{upstream}` is the same branch on the remote, not the base: on a fully pushed branch that range is empty.

**Choose the base in this order:**
1. A merge request is known → `origin/<its target branch>` ("Read a merge request" in `forge.md`). The target is not always the default branch (an epic branch, `develop`, a stacked merge request): never substitute `main`.
2. Mode `pre-mr`: the branch the merge request will target. The user or the flow named it → that; otherwise as in 3.
3. No merge request → `jig review-plan` without a base tries `@{upstream}`, then `origin/HEAD`, and prints which one it took. Name a guessed base in the report: without a merge request it is a guess, and in GitFlow the real base is usually `develop`.

The reviewed diff is `git diff $(git merge-base <base> HEAD)`: the commits of the branch plus uncommitted changes. New untracked files are not in it: `jig review-plan` counts them; in mode `pre-mr` run `git add -N <files>` so they are reviewed.

**Scope in mode `pre-mr`.** The working tree is part of the diff, so uncommitted work that is not the task's (another agent, a parallel task, the user's edits) would be counted and reviewed. `git status` shows changes outside the task's files → pass the task's paths after `--` to `jig review-plan` (relative to the current directory, as in git). It counts, shapes and prints the diff for those paths only, and fails when nothing under them changed.

**Three dots, never two.** `<base>..HEAD` pulls in everything merged into the branch from the base: on a branch with a merge that is dozens of foreign files every finder reads and nobody can post on. A range computed with two dots anywhere in the run is intersected with `git diff --name-only <base>...HEAD`, and what was cut is named in the summary ([re-review](09-rereview.md) computes its scope this way).

## Selector

The first word after the mode, target and flags, if it is a preset or every token is in the [selector](../references/selector.md) vocabulary. Parse it before anything else: it decides whether standard documents are searched ([step 02](02-rules.md): only when angle 6, 10 or 13 runs; indexes with severity and skip rules are searched always) and whether the spec is searched (only when angle 15 runs).

## Focus note

Any text after the target, selector and flags is a free note **for this run**: task context, a risk area, "check X". It goes into every finder brief as an extra lens: relate the diff to the note; whatever the note requires and the code does not deliver is a candidate, usually `correctness`.

- The focus directs attention; it does not change severity.
- It does not override the skill's rules or the project's review document, and it does not enable what they forbid.
- Keep it short: its length multiplies by the number of agents.

## Facts and decisions

A block of the shared prefix for finders and judges ([finders](04-finders.md)): what is already established, so no agent raises it again. Four finders raising "empty PUT body" after the caller had already seen the server answer `"OK"`, and a decision recorded in `AGENTS.md` reaching the judge as a bug, are the failures this block prevents.

- **Facts:** what the calling session checked itself (a server response, the code of an external system), each with its source. A review with no calling session: empty. In mode `pre-mr` the session wrote the code: list what it ran and saw.
- **Owner decisions:** sentences from the found `AGENTS.md` and decision documents ([step 02](02-rules.md)) and from the merge request description where a behavior is called intentional. Each with `path:line` or "merge request description".

Claims only, no retelling of documents, up to ~30 lines. In the summary: `facts: N · decisions: M`.

## Spec

The source of the diff's goal for [angle 15](../angles/15.spec.md). **The spec of a task is what was asked of it**: the task's own text in its tracker (the issue or ticket, its subtasks and comments), or a spec or PRD document that the task or the merge request links. Nothing else is a spec: a project document that describes the area the diff touches (`docs/<area>/spec.md`, a README, a widget's as-is description) is context for the rules finder, never the spec, however it is named. Angle 15 and a review cycle's spec hold are judged against the task's spec only. This is the one definition: a process adapter's `spec` op and `jig review-cycle spec` answer by it too.

Angle 15 not selected: no search. `discover.spec: false` turns it off. Otherwise, the first found wins:

1. a `Spec: <path>` line in the focus note (a review cycle passes the adapter's answer this way) → that file;
2. the tasks the merge request names: issue references and tracker keys (`#123`, `Closes #45`, `PROJ-46`) in its title and description, its source branch name and the commit messages of the range → each named task read in its tracker with its subtasks and comments (the comments matter for [`spec_quote`](../angles/15.spec.md#spec_quote)). A named task is always read, through whatever reaches its tracker (the forge CLI for forge issues, a tracker CLI or tool the session has); no way in → `spec: not found (<key>: no access)`, never a fallback to another source;
3. a spec or PRD document that the task from item 2 or the merge request description links.

The merge request description is only a source of references: the author of the diff writes it, and a mismatch between it and the code is documentation drift, not a spec finding. Nothing found: angle 15 does not run, the summary says `spec: not found`. Do not ask the user: a spec is not a precondition of a review. The text found goes **only into the personal tail of the finder that carries angle 15**, never into the shared prefix.

**Keep the text you judged by.** A spec that is not already a file (a task read from its tracker, a linked page) is written once to a file, all of its texts together: with state on `<state file without .json>.spec.md` next to the state file, otherwise a temporary file. The output names the source and that file ([output](08-output.md#output), the `spec` tail), so a caller checks spec quotes against the same text the finder read.

## Layout

```bash
node <root>/bin/jig.mjs review-plan <base> [--selector <selector>] [--layout <layout>] [--spec] [--mode pre-mr] [--mr] [--no-state] [-- <path>...]
```

`--spec` when a spec was found. `--mode pre-mr` in mode `pre-mr`. `--mr` in mode `review` when a merge request is known: it turns state, comment texts, re-review and posting on. `--no-state` passes the flag of the same name. No selector argument: pass none; the command picks the default. It prints, and with `--json` returns as data:

- `LINES`: added + removed lines by `git diff --numstat -M` against the merge base, without tests, fixtures and `*.md`. A rename without edits counts 0. Documents are judged by angle 11 and add no readers to the bug finders. With paths, the `lines:` line names the scope.
- `diff:` the command that prints the reviewed diff, paths included. Every brief and your own reading use this command, never a hand-written `git diff`.
- `N = ceil(LINES / 150)`, at most 5. `N = 1`: `path: inline` in every layout.
- the layout (`--layout`, else `JIG_REVIEW_LAYOUT`, else `layout` in the [project config](../references/project-config.md), else `auto`). `auto`: `N ≤ 2` → `inline`, you review in this session ([inline](04-inline.md)), on `quick` unless a selector was given; `N > 2` → `lean`: up to four bug finders plus cleanup, the rules finder and the tests-and-comments finder on top when the diff shape calls for them, all on the standard tier, and you judge ([verify](05-verify.md#layout-lean)). Measured on reference merge requests: inline found the known bugs at 40 and 212 lines and missed the one at 784, which the lean finders found; `fanout` and `solo` found nothing more at 212 lines for 6-7 times the cost.
- the diff shape (tests, added comments, Markdown, new source files, spec), the selector expanded (`auto` too), the mode and whether state is on, every finder (or the inline reader) with its angles, tier, effort and model and the absolute paths of its angle files (`read:`) and atoms (`atoms:`), the judge model per finder model, the subagent cap, and the angles skipped with the reason;
- last, **the steps for this run**: the files to read from here on, in order. Only those apply.

The printed layout is the plan; do not recompute it by hand. No caps on the number of findings: whatever survives the gates reaches the author.
