# Review

`/jig-review` reviews a diff the way a careful team does: several reviewers each ask their own question, and a second reviewer on another model throws out every finding that has no proof. Code plans the run, models only hunt and judge, and every change to the review process is measured against reference merge requests before it ships.

Two modes:

- **`review`**: someone else's merge request or branch. Findings become threads (`--post`), a state file remembers them, and the next run reviews only the new commits and checks every open thread against them.
- **`pre-mr`**: your own diff before the merge request; every code-changing flow runs it in its [`mr`](../skills/jig/flows/mr.md) step. A verdict in four buckets instead of threads.

`/jig-review-cycle` runs `review` over every merge request waiting on you ([review cycle](review-cycle.md)).

## The pipeline

```text
jig review-plan     code: counts the diff, picks the angles and the layout, partitions the files, splits the diff into parts, estimates the cost
   finders          models: one per partition, every angle, reads only its partition's parts, traces links into the rest
   dedup            one defect raised by several finders becomes one candidate
   judges           another model: CONFIRMED or REFUTED, each with a quoted line
   gates            severity, shape and rare gates cut what does not block a merge
   output           threads, an FYI note, or the four buckets of pre-mr
```

**The plan is deterministic.** `jig review-plan` decides from the diff alone: how many lines count, which angles run, how the files split into partitions, inline or with finders, which model and effort each finder gets, which judge, what the run should cost, and which step files the agent reads. Same diff, same plan ([commands](commands.md)).

**Finders split the files, not the questions.** The diff's files go into `N` partitions: files that import each other or share a directory stay together. A project that knows its modules better writes the rule as text instead (`partitions` in `.jig/review.jsonc`, e.g. one finder per feature module): `jig review-plan` then prints that text with the changed files, their lines and imports, the review runner groups them by it, and `jig review-plan --partition <name>=<paths>` writes the parts and finders for those groups; every finder gets the text. Each finder takes one partition with every selected angle and reads only its part of the diff; behavior on the other side of a partition it reads in the code itself, and a candidate that crosses partitions names the link and the other side's `file:line` so the judge checks both sides. When finders split by angle, each re-read the whole diff: on a 10,263-line merge request seven of them cost about $90, mostly re-reading the same context.

**Angles, not topics.** An angle is one concrete question with a procedure and a condition for evidence. There are 11: bugs (line by line, removed behavior, call tracing, language traps, wrappers, guards without siblings, security), efficiency (leaks, CPU load the user feels, work on a proven hot path), spec conformance, wrong and redundant tests, and UX (what the user of changed UI meets with realistic data, by atom `ux`: layout under worst-case values with wrappers taken into account, missing states, raw formats, unreachable actions, motion) ([angles](../skills/jig-review/angles/00-index.md)).

**The review hunts what the user meets, not the shape of code.** Duplication, naming, style, layers and imports, comments and documents are left to the project's checks: a linter, a type checker or an architecture check proves them for free and blocks the merge, while a reviewer turns them into nitpicks. A project that still wants one reviewed adds its own angle of kind `conventions` in `.jig/review.jsonc`; the old numbers (6, 7, 9, 10, 11, 13, 17) stay accepted there and change nothing. Tests stay reviewed: angle 16, run by role `test-reviewer` on an economical tier, finds a test that cannot fail when the behavior it names breaks (`Important`) and a redundant one (`Nit`): a duplicate in another partition too, through the plan's `tests parts of the run` line, and fixture data no test reads; `angles.16.enabled: false` turns it off. It reports; the author deletes.

**A finder is aggressive, a judge is strict.** Finders look for everything their angles ask. Judges run on a different model than the finder whose candidates they judge, so one model's blind spot does not confirm itself. A defect two models found independently is the strongest signal of a run.

**A bug needs a proof in three parts**, each quoted: the initiator in a production build (a user action, a system event, a backend response), the path as `file:line` for every step to the defective line, and the effect, observable and wrong by the requirement. Any part missing: `REFUTED: not proven`. "The mechanism is real, the trigger is not proven" is not a third verdict ([bug gates](../skills/jig-review/gates/bugs.md)).

**A bug a tester does not meet is a known risk, not a task.** When a user or a tester who uses the feature as intended never reaches the bug (an extreme value, a hand-edited file, a rare sequence or timing), it gets one summary line and no thread. Data loss, security, a broken invariant and what the project's severity sections name (an irreversible action, a missed alarm) stay tasks however rare ([rare gate](../skills/jig-review/gates/bugs.md#rare-gate)).

**Severity is a closed list.** `Important` means the merge waits: broken behavior, data loss, a crash. Everything else is a `Nit`. A project replaces the list with its own ([severity](../skills/jig-review/gates/severity.md)).

When a diff adds modules, a deepener proposes the one module deepening with the most effect: a proposal in the FYI note (in the comment language, a labelled line per field, with a before and after Mermaid diagram of the modules), never a thread.

**Spec conformance.** When the task has a spec (the tracker text or a linked spec), angle 15 checks what is missing, what was not asked for and what was done differently. All deviations go into one thread, item by item, grouped by those three kinds; it resolves when every item is closed.

## One layout for every size

Counted lines leave out tests, fixtures, documents, lock files and unedited renames; `N = ceil(lines / 150)`, at most 5.

| diff | layout | who hunts | who judges |
| --- | --- | --- | --- |
| any size (`auto`) | lean | per partition a fresh `behavior` finder (bugs, state, contracts, efficiency, spec; deep/high), plus a `test-reviewer` (standard/medium) for wrong and redundant tests (angle 16) when the partition has changed tests, a `ux` finder (standard/high, angle 18) when it has changed UI files, and a `conventions` finder (standard/high) only for the project's own angles of that kind | the session; one judge on another model for the `Important` ones |
| any, by `--layout solo` | solo | the same finders | each finder proves its own candidates; no judge |

Without state the run's diff parts go to the OS temp dir; each plan prints a new `run:` id, and finder checkpoints are reused only by a retry of the same run. `jig review-plan` prints a one-line cost estimate: each finder, by the context its share of the diff grows and the turns it takes (calibrated on a measured 10,263-line run: a finder about 100 turns at 250-400k tokens), at the list prices of each finder's tier model (`prices` in the [user config](configuration.md#user-config) override them); the runner and the judges are not in it.

A re-review under 600 new lines is one partition with its finders. A selector narrows a run: `quick` keeps only what blocks a merge, `full` runs every angle, `auto` picks by the diff shape, tokens like `bugs,security` pick by hand ([selector](../skills/jig-review/references/selector.md)).

## Re-review and outcomes

With state, the next run on a merge request:

- compares the diff hash first: a rebase with the same content reviews nothing and only reads new replies;
- takes the scope from per-file patches against the base (`jig review-plan <base> --rereview --state <path>`), so a force-push or a base merged into the branch counts only the branch's own new work, and a renamed file counts only the lines that differ from its reviewed patch;
- reviews only the new range, and checks every open finding against the current tree: `fixed`, `open`, `no_change_needed` or `unverified`, each with its line;
- answers every developer reply in its thread.

In the review cycle a posted `Important` that still stands sends the merge request back to the developer ([outcomes](review-cycle.md#outcome-of-a-merge-request)).

## Pre-mr buckets

- **Act on**: confirmed `Important`. The agent fixes these before the merge request.
- **Consider**: confirmed `Nit`, pre-existing defects, unrequested spec items, the deepening proposal. The agent asks you, with a recommendation.
- **Noted**: valid but not actionable now, listed briefly.
- **Dismissed**: everything refuted, with the judge's reason.

## Rules of every run

- A review only reads: no edits, commits, tests, builds or installs, the subagents included. A claim only a test would settle is not proven.
- A rule the linter, formatter or type checker enforces is not a finding. A project rule tooling does not enforce is, with a quoted line of the rule's document.
- The diff is written once into parts (code, tests, docs); each finder reads only its parts and code around them in small windows.
- At most `maxParallel` subagents at once (6 by default); each gets its model tier and effort explicitly.

## Project config

`.jig/review.jsonc`, committed or local, is optional; a linked worktree uses the one its branch tracks, otherwise the main checkout's: documents to discover (rules, standards, spec, glossary), the project's own severity sections, angles turned off or with a new severity ceiling, tiers, `maxParallel`, the default layout and extra test globs, the language of comments and merge request descriptions, the repository's merge request standard a description must carry ([project config](../skills/jig-review/references/project-config.md)).

## Measured

- **Cost**: `jig review cost` estimates a run's spend per role and per merge request, the session that ran the review included, with $ per 1000 diff lines and $ per thread; `--record` and `--report` compare runs across projects and weeks ([commands](commands.md)). A review with finders runs in one review-runner subagent; its finders are spawned fresh on the tier and effort the plan prints, never forked.
- **Quality**: an edit of the review's steps, angles, gates, tiers or briefs runs on reference merge requests, old and new versions blind to a judge. It does not merge when it misses a defect the old version found or posts a false finding the old one did not. Every missed defect and every false thread found later joins the corpus ([eval](../skills/jig-review/references/eval.md)).
