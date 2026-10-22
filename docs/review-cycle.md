# Review cycle

`/jig-review-cycle [<focus>]` runs **one idempotent pass**: `jig review-cycle queue` lists the triggered merge requests and skips the approved (by anyone), the drafts, those whose review worktree is still live, those whose head the review state already covers with no new developer reply, and, when the adapter says `stale=on`, those where your open threads still wait on the developer. Each remaining one gets a worktree (seeded with the gitignored files, no dependencies: a review reads code and never runs tests; links are removed first, so what a link points to in the main checkout survives the teardown), a `jig-review` run in a subagent (two at a time), a check that the run accounted for every standing finding, a poster subagent, and last one `transition` per ref. An agent without subagents runs them one by one. Nothing sleeps or polls.

## Outcome of a merge request

The verdict folds one outcome per merge request: `returned`, `ready`, `approved` or `held`.

- **An Important that stands returns the merge request.** A posted Important the outcome check left `open` or `skipped`, in a thread still open, means the merge request waits on the developer: `returned`, whether this pass reviewed it or skipped it. A developer who pushes a commit that does not fix it and asks for review again gets it back, with one note in the thread: ``after `<sha>` the defect stands: <the line>``, once per commit. A merge request moved back to review by hand with no commit and no reply (`SKIP unchanged`, or `SKIP stale` under `stale=on`) goes back too, with nothing posted; `queue` prints the outcome as `outcome=` on every `SKIP` line, and the summary names these as `returned without review`. A `held` here would leave the ref in review, and the developer waiting on a review that has already decided.
- **Nit, Pre-existing and optional items never return or hold a merge request.** An `unverified` Important does not return it either: the check could not tell.
- **A dispute left to a human** is `held`: it waits on the human.
- **A reply is never skipped as stale.** A developer note in my open thread, or under my FYI note, after my last note there makes the merge request actionable. An answer under the FYI note, or a new commit, rechecks the optional items: the done ones are ticked in the note.

## Process adapter

What triggers a review and where the verdict goes is the team's: a **process adapter**, any executable answering `queue`, `rules`, `spec`, `base-check` and `transition` ([contract](../skills/jig/references/process-adapter.md)), named in `.jig/config.local.jsonc`:

```jsonc
{ "reviewCycle": { "processAdapter": "~/review/process.mjs" } }
```

Without one, the queue is the forge's open merge requests where you are a reviewer, the adapter gives no spec and nothing is recorded in a tracker; `queue` prints a `WARNING built-in adapter: …` line first and the summary repeats it. GitLab through `glab`, GitHub through `gh` (no withdrawal yet); `reviewCycle.forge` overrides the detection by the `origin` remote.

## Recurrence

The skill never schedules itself (`jig loop` is the weekly journal loop, not this). Recurrence is the caller's:

- Claude Code: `/loop 2h /jig-review-cycle`. A new focus later: run `/jig-review-cycle <focus>` once; it is stored in `.jig/runs/review-cycle/focus.md` and every later firing reads it.
- cron, a CI schedule or Task Scheduler: a headless agent run of the skill in the repository, e.g. `claude -p "/jig-review-cycle"` every two hours. The pass is idempotent, so an overlapping firing skips what the previous one is still reviewing.

## Cost

Each pass records its estimated cost with `jig review cost --record`; `jig review cost --report --by project` (or `--by week`) compares $ per 1000 diff lines and $ per thread across projects and over time, so a change to the process shows its effect ([commands](commands.md)).

Every subagent of a pass (a runner, its finders, judges and poster: twenty or more) starts with the session's fixed context: instructions, the skill list, MCP server instructions. A plugin no review role uses still costs in each of them: on one pass an unused design plugin was ~2.7k tokens per subagent, about a twelfth of all input. Turn such plugins off in a project where review cycles run unattended (Claude Code: `enabledPlugins` in the project's `.claude/settings.local.json`), and on again for the work that needs them.

## Importing older review state

Coming from review skills that kept their state under the OS temp folder (`<temp>/claude-review/<repo>-<key>.json`): `jig review-cycle import-state [--from <dir>] [--dry-run]`, run in the repository, copies the files of its `origin` into `.jig/runs/review/`, so the first pass skips what they already reviewed. A file jig's state parser rejects is skipped with the reason, fields outside jig's schema are dropped and listed, and a jig state that finished at the same time or later is never replaced. It writes nothing unless `.jig/runs/` is gitignored.
