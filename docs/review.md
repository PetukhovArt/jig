# Review

`/jig-review` reviews a diff the way a careful team does: several reviewers each ask their own question, and a second reviewer on another model throws out every finding that has no proof. Code plans the run, models only hunt and judge, and every change to the review process is measured against reference merge requests before it ships.

Two modes:

- **`review`**: someone else's merge request or branch. Findings become threads (`--post`), a state file remembers them, and the next run reviews only the new commits and checks every open thread against them.
- **`pre-mr`**: your own diff before the merge request; every code-changing flow runs it in its [`mr`](../skills/jig/flows/mr.md) step. A verdict in four buckets instead of threads.

`/jig-review-cycle` runs `review` over every merge request waiting on you ([review cycle](review-cycle.md)).

## The pipeline

```text
jig review-plan     code: counts the diff, picks the angles and the layout, splits the diff into parts
   finders          models: each hunts its angles, reads only its parts of the diff
   dedup            one defect raised by several finders becomes one candidate
   judges           another model: CONFIRMED or REFUTED, each with a quoted line
   gates            severity, shape and rare gates cut what does not block a merge
   output           threads, an FYI note, or the four buckets of pre-mr
```

**The plan is deterministic.** `jig review-plan` decides from the diff alone: how many lines count, which angles run, inline or with finders, which model and effort each finder gets, which judge, and which step files the agent reads. Same diff, same plan ([commands](commands.md)).

**Angles, not topics.** An angle is one concrete question with a procedure and a condition for evidence. There are 17, grouped as bugs (line by line, removed behavior, call tracing, language traps, wrappers, guards without siblings, security), rules (reuse, conventions and smells, architecture with ADRs and glossary), cleanup (simplification, efficiency, fix altitude, documents, tests, comments) and spec conformance ([angles](../skills/jig-review/angles/00-index.md)).

**A finder is aggressive, a judge is strict.** Finders look for everything their angles ask. Judges run on a different model than the finder whose candidates they judge, so one model's blind spot does not confirm itself. A defect two models found independently is the strongest signal of a run.

**A bug needs a proof in three parts**, each quoted: the initiator in a production build (a user action, a system event, a backend response), the path as `file:line` for every step to the defective line, and the effect, observable and wrong by the requirement. Any part missing: `REFUTED: not proven`. "The mechanism is real, the trigger is not proven" is not a third verdict ([bug gates](../skills/jig-review/gates/bugs.md)).

**Severity is a closed list.** `Important` means the merge waits: broken behavior, data loss, a crash, a broken layer or a module in the wrong place, a responsibility spread across modules, a contradicted ADR, a structural smell, a false guarantee (a test that cannot fail, a comment the code contradicts). Everything else is a `Nit`. A project replaces the list with its own ([severity](../skills/jig-review/gates/severity.md)).

**Architecture is reviewed, not only bugs.** Angle 13 checks layers and boundaries, ADRs in force and glossary terms. When a diff adds modules, a deepener proposes the one module deepening with the most effect: a proposal in the FYI note, until a confirmed finding of the run is an instance of the scattering it names: then it is a finding of its own, with that instance as proof.

**Spec conformance.** When the task has a spec (the tracker text or a linked spec), angle 15 checks what is missing, what was not asked for and what was done differently.

## Size decides the layout

Counted lines leave out tests, fixtures, documents, lock files and unedited renames; `N = ceil(lines / 150)`, at most 5.

| diff | layout | who hunts | who judges |
| --- | --- | --- | --- |
| `N ≤ 2`, up to 300 counted lines | inline | the session itself | the session; a judge on another model only for an `Important` |
| `N > 2` | lean | finders forked from the review runner, one per angle group | the session; one judge on another model for the `Important` ones |
| any, by `--layout` | `fanout`, `solo` | finders split by tier, or finders that prove their own candidates | a judge per cluster, or none |

A re-review under 600 new lines runs one finder with every angle. A selector narrows a run: `quick` keeps only what blocks a merge, `full` runs every angle, `auto` picks by the diff shape, tokens like `bugs,architecture,tests` pick by hand ([selector](../skills/jig-review/references/selector.md)).

## Re-review and outcomes

With state, the next run on a merge request:

- compares the diff hash first: a rebase with the same content reviews nothing and only reads new replies;
- takes the scope from per-file patches against the base (`jig review-plan <base> --rereview --state <path>`), so a force-push or a base merged into the branch counts only the branch's own new work;
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

`.jig/review.jsonc`, committed, is optional: documents to discover (rules, standards, spec, ADRs, glossary), the project's own severity sections, angles turned off or with a new severity ceiling, tiers, `maxParallel`, the default layout and extra test globs ([project config](../skills/jig-review/references/project-config.md)).

## Measured

- **Cost**: `jig review cost` estimates a run's spend per role and per merge request, the session that ran the review included, with $ per 1000 diff lines and $ per thread; `--record` and `--report` compare runs across projects and weeks ([commands](commands.md)). A review with finders runs in one review-runner subagent, so its finders fork from the review's context, not from the conversation that asked for it.
- **Quality**: an edit of the review's steps, angles, gates, tiers or briefs runs on reference merge requests, old and new versions blind to a judge. It does not merge when it misses a defect the old version found or posts a false finding the old one did not. Every missed defect and every false thread found later joins the corpus ([eval](../skills/jig-review/references/eval.md)).
