# State, learnings, adopting threads

Only mode `review` with a known merge request (`jig review-plan --mr` printed `state: on`): the state carries threads across sessions. Mode `pre-mr` and a review of a bare branch skip this step: no file under `.jig/runs/review/` is read or written, learnings included.

## State

**`--no-state` turns off the whole step.** Then no file is read or written, the run is always a first run, the outcome check does not run, learnings are neither applied nor added, `runs` is not counted. The summary says one line: `state: off (--no-state)`. Diagnostic mode: run the pipeline clean on any branch.

Without the flag:

```
KEY  = the first 12 characters of: printf '%s' "<remote_url>:<target>" | git hash-object --stdin
file = <main checkout>/.jig/runs/review/<KEY>.json
```

`node <root>/bin/jig.mjs review-cycle state-path <merge request number>` prints this path from inside the repository; use it rather than computing the key by hand. `target` is the merge request number when known, otherwise the name of the reviewed branch. `remote_url` from `git remote get-url origin`. The **main checkout** is the first entry of `git worktree list`: a review that runs in a linked worktree (a review cycle gives each merge request its own) reads and writes the same file as one in the main checkout, and the file outlives the worktree. `.jig/runs/` stays out of git. Write the file with an absolute path resolved in the same command that uses it: shell state does not survive between tool calls.

Schema and field semantics: [`../references/state-schema.md`](../references/state-schema.md). Read it before reading or writing state.

**The file decides the mode, not ancestry.** File exists → [re-review](09-rereview.md). No file → first run.

`last_reviewed_sha` is an ancestor of HEAD: the scope is incremental. The ancestry broke (force-push): the run stays a re-review, and the scope is restored by [patch comparison](09-rereview.md#scope-after-a-force-push); no scope from it → the full diff. The full diff is a wider scope, not another mode: earlier findings still have open threads, and the outcome check must run anyway.

**Clock.** A UTC ISO-8601 stamp (`2026-08-07T16:30:00Z`) once at the start and at every phase boundary. The deltas go into `timings`. Time is a measurement, never a budget: no phase is cut short because it runs long.

## Learnings

A repository-level file: `<main checkout>/.jig/runs/review/learnings.json` (no KEY: the rules outlive one merge request). Schema: [`../references/learnings-schema.md`](../references/learnings-schema.md).

Each entry is one skip or demote rule derived from a dispute the developer won ([re-review](09-rereview.md)). File exists → the active entries go into every finder and judge brief as a block **below the project's review document and above the skill's defaults**.

**Applied differently by angle class:**
- rules 6, 10, 13, cleanup 7–9, 11 and spec 15 → a matching candidate is dropped;
- bugs 1–5, 12, 14 → **never dropped**, at most demoted to `Nit`. A stale learning must not silently mute a real bug.

A learning matches only when both the mechanism and the context match. "retry without backoff in polling" does not cover a retry elsewhere.

## Adopting your own threads

Before the phases, when the merge request number is known and state is on. Take every thread that is **yours, unresolved and unknown to state**: a thread written by hand carries a defect state does not know, and without adoption the run finds it again as a second thread.

Threads: "Read its threads" in `forge.md`. Your user: `glab api user` (`.id`) or `gh api user` (`.login`).

- **yours** = the author of the first note is you and that note is not a system note. **The first note owns the thread**: someone else's thread stays theirs even when you replied in it;
- **unresolved** = some note is resolvable and not resolved (GitHub: the review thread is not resolved);
- **unknown** = its id matches no `discussion_id` in state.

Each adopted thread adds a finding: `discussion_id` = the thread id, `status: "open"`, `file`/`line` from the position of the first note (no position: a note outside the diff, skip it), `summary` = the first line of the note, `mrComment` = the note body, `category: "correctness"`, `severity: "Important"`, `verdict: "CONFIRMED"`, `id` = `<file>:<line>:adopted-<thread id>`.

`discussion_id` keeps the finding out of the postable set: adoption never reposts what is already on the merge request.

Adopted findings enter the [outcome check](09-rereview.md#outcome-check) like the rest, **including on a first run**: one adoption turns the outcome check on. Their text is a human note, not a machine finding: the check judges the described defect against the code, and `unverified` is an honest answer when the note is too vague.
