# Review cycle

`/jig-review-cycle [<focus>]` runs **one idempotent pass**: `jig review-cycle queue` lists the triggered merge requests and skips the approved (by anyone), the drafts, those whose review worktree is still live, those whose head the review state already covers with no new developer reply, and, when the adapter says `stale=on`, those where your open threads still wait on the developer. Each remaining one gets a worktree (its `node_modules` linked to the main checkout's when the lock file is byte-identical; otherwise none, and judges run no tests there; removed links first, so the main checkout's `node_modules` survives the teardown), a `jig-review` run in a subagent (two at a time), a check that the run accounted for every standing finding, a poster subagent, and last one `transition` per ref. An agent without subagents runs them one by one. Nothing sleeps or polls.

## Process adapter

What triggers a review and where the verdict goes is the team's: a **process adapter**, any executable answering `queue`, `rules`, `spec`, `base-check` and `transition` ([contract](../skills/jig/references/process-adapter.md)), named in `.jig/config.local.jsonc`:

```jsonc
{ "reviewCycle": { "processAdapter": "~/review/process.mjs" } }
```

Without one, the queue is the forge's open merge requests where you are a reviewer, and nothing is recorded in a tracker. GitLab through `glab`, GitHub through `gh` (no withdrawal yet); `reviewCycle.forge` overrides the detection by the `origin` remote.

## Recurrence

The skill never schedules itself (`jig loop` is the weekly journal loop, not this). Recurrence is the caller's:

- Claude Code: `/loop 2h /jig-review-cycle`. A new focus later: run `/jig-review-cycle <focus>` once; it is stored in `.jig/runs/review-cycle/focus.md` and every later firing reads it.
- cron, a CI schedule or Task Scheduler: a headless agent run of the skill in the repository, e.g. `claude -p "/jig-review-cycle"` every two hours. The pass is idempotent, so an overlapping firing skips what the previous one is still reviewing.

## Importing older review state

Coming from review skills that kept their state under the OS temp folder (`<temp>/claude-review/<repo>-<key>.json`): `jig review-cycle import-state [--from <dir>] [--dry-run]`, run in the repository, copies the files of its `origin` into `.jig/runs/review/`, so the first pass skips what they already reviewed. A file jig's state parser rejects is skipped with the reason, fields outside jig's schema are dropped and listed, and a jig state that finished at the same time or later is never replaced. It writes nothing unless `.jig/runs/` is gitignored.
