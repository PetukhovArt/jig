---
name: jig-review-cycle
description: "Review every merge request awaiting your review in one pass: filter, review each in its own worktree with jig-review, post the threads, record the verdict through the team's process adapter."
argument-hint: "[<focus note>] [--no-focus]"
---

# jig-review-cycle

Plugin root: `${CLAUDE_PLUGIN_ROOT}` when the agent sets it, otherwise the directory two levels above this file; below, `<root>` means this path. CLI: `node "<root>/bin/jig.mjs" <command>`; `jig <command>` below means this. Roles: `<root>/skills/jig/references/roles/<name>.md`, tier and effort in `<root>/skills/jig/references/roles.md`. Forge commands: `<root>/skills/jig/references/forge.md`. The review engine is jig-review: `<root>/skills/jig-review/SKILL.md`.

Discover → filter → review → post → verdict. You are the orchestrator: you **never review or post by hand**. You spawn subagents, own the worktrees and the verdict. What triggers a review and where a verdict is recorded belongs to the team's **process adapter** (`<root>/skills/jig/references/process-adapter.md`); this file never names a label or a tracker status. The deterministic parts are `jig review-cycle <sub>`; never recompute what it prints.

## Output: keep the main context lean

The user-facing text of a pass is the [summary](#4-summary) (when everything was skipped, its one-line form), plus the reason when discovery aborts. Per-merge-request progress is not narrated: under a loop each restated line stays in the main context for every later pass.

## Arguments

- **focus text**: everything that is not a flag: sets the standing focus note ([focus note](#focus-note)).
- **`--no-focus`**: deletes the focus note; every later pass runs unfocused.
- **`--post`**: accepted and ignored: the pass always posts, through the poster.
- An interval (`2h`) is focus text like any other word: this skill never schedules.

A single named merge request is jig-review's job directly (`/jig-review <url> <focus>`); this skill's target set is the queue.

## One pass, never a schedule

Sections 1–4, then stop. Never arm, re-arm or reason about a schedule: a skill that scheduled itself would add another schedule on every firing. Recurrence is the agent's or the operating system's (docs/review-cycle.md, "Recurrence"). The pass is idempotent: a merge request whose head was already reviewed and has no new developer reply is skipped, and one whose worktree is still live (the previous pass is reviewing it) is skipped as `busy`.

**Nothing waits on an external system.** No `sleep`, no polling, no retry loop until a pipeline finishes, a developer answers or a label appears: every external fact is sampled once per pass. Wait for a subagent by its completion notification, or run it in the foreground.

## Agent

- **Subagents** (preferred): roles `review-runner` and `poster`, each spawned with a prompt that begins `Read <root>/skills/jig/references/roles/<name>.md and follow it.`, then its brief. The review runner must be able to spawn its own subagents (jig-review fans out finders and judges): in Claude Code a `general-purpose` agent. Each role runs on its template's tier and effort (`jig tiers` maps the tier to a model), never the session's model: the runner is deep/medium (on standard it skipped steps and read ones its plan did not list), the poster is fast/low.
- **Fork runners for re-reviews** (an agent that forks with the parent's context; Claude Code: `subagent_type: fork`). Once per pass, before the first runner, read the engine files every re-review reads: jig-review's `SKILL.md`, `steps/01-prepare.md`, `02-rules.md`, `03-state.md`, `09-rereview.md`, `<root>/skills/jig-review/references/state-schema.md`. A fork runs on this session's model and spawns no subagents, so it pays off only for a re-review that runs inline; the [plan](#2-review-each-actionable-merge-request) (step 4) decides before the spawn. Such a merge request gets a fork runner: its brief adds `prepared: <those paths>`, and the fork starts from your prompt cache instead of reading them again. `state=none` (a first run, which may fan out), a re-review whose plan has finders, and a fork's `needs fan-out` return get a fresh runner on the role's tier; `needs fan-out` is not a failure of [proof of run](#2-review-each-actionable-merge-request). An agent without forks: fresh runners only.
- **Only your own subagents report to you.** A runner runs its finders and judges in its foreground, so their reports go to it. A report of a finder, deepener or judge that still reaches this session belongs to a runner: do not act on it, do not forward it, do not count it; findings reach you only in a runner's return.
- **Waves of 2.** At most two review runners at once; a poster counts against the same cap. When one returns, start the next merge request (its worktree, then its runner), and spawn each poster as soon as its review returns.
- **No subagents** (an agent without them): run the merge requests one by one in this session: `cd` into the worktree, read jig-review's `SKILL.md` and run it there, then follow `posting.md` yourself. The steps and checks below stay the same; only who runs them changes.

## Focus note

A file that outlives the session which aimed the review, so every later pass reviews under the same focus: `<main checkout>/.jig/runs/review-cycle/focus.md` (out of git with the rest of `.jig/runs/`).

Every pass, before discovery:

1. Focus text in the arguments, or a focus the session established in conversation → **overwrite** the file with a distillation written per [`references/focus.md`](references/focus.md), and use it.
2. `--no-focus` → delete the file; this pass runs unfocused.
3. Neither → read the file; absent → unfocused, and nothing is written.

Read it once per pass. **Focus never selects merge requests**: the queue alone decides what is reviewed; focus changes how each one is read.

## Base-check

The focus note every review runner passes to jig-review, identical for every merge request of the pass:

- linked task, issue or spec → understand the goal;
- no new stop-gaps;
- the task is really done per the issue; docs do not lie.

Then every bullet `jig review-cycle base-check` prints (the project's own checks), then the focus file's content verbatim. The focus is appended, never substituted: the base-check is what makes an unattended pass useful.

## 1. Discover and filter

```bash
node "<root>/bin/jig.mjs" review-cycle queue
```

Run it from inside a repository of the queue. It asks the adapter (or the built-in default) for the triggered merge requests, then applies the filter rules in order and prints one line per merge request, tab-separated. Every `SKIP` line carries `outcome=<outcome>`: the skipped merge request's argument to the [verdict](#3-verdict-last).

| Line | Meaning |
| --- | --- |
| `WARNING <text>` | first line, only without a configured adapter: the built-in default reviews the forge's reviewer queue, has no tracker spec and records no verdict. Keep it for the summary; the pass goes on. |
| `SKIP approved …` | anyone approved: re-reviewing could only comment on code cleared to merge. Its outcome is `approved` (the verdict clears the marker). |
| `SKIP draft …` | not ready. |
| `SKIP busy …` | its review worktree is live: a previous pass is still on it. |
| `SKIP unchanged …` | the head equals the state's `last_reviewed_sha` and no developer note in an open thread of yours, or under your FYI note, is newer than your last note there. `outcome=returned` when an Important of the state stands (`open` or `skipped`) in a thread still open: the developer has not answered it, and a merge request moved back to review by hand goes back to the developer instead of waiting on nobody. Otherwise `outcome=held`. |
| `SKIP stale …` | the adapter says `stale=on`, you hold an unresolved thread, no commit landed after your last note and nobody answered you since: you flagged, the developer has not responded. `outcome=` as for `unchanged`. |
| `BLOCKED <refs> <repo_dir> <iid> <url> <reason>` | the environment could not answer for this one (exit 3 of a forge call, exit 4 of `rules`). Not reviewed, not skipped: its own summary line. |
| `ACTIONABLE <refs> <repo_dir> <iid> <branch> <url> worktree=… state=… standing=N` | review it. |
| `NOTE <refs> <text>` | keep for the summary. |

Open Nit and Pre-existing threads never make a merge request stale, never return it and never withhold `ready`: they are suggestions the developer may decline.

**Exit 3 aborts the pass**: nothing was discovered, so nothing can be judged; show the reason. Never retry from another directory or fall back to reviewing anyway: an unreachable API is indistinguishable from an empty project.

## 2. Review each actionable merge request

Every command for one merge request runs with `-C <repo_dir>` or from `<repo_dir>`.

1. **Worktree**, at the `worktree=` path: `git -C <repo_dir> fetch origin <branch>`, `git -C <repo_dir> worktree add --detach <worktree> origin/<branch>`, `node "<root>/bin/jig.mjs" worktree seed <worktree>` (gitignored files such as `.env`). The worktree gets no dependencies and nobody installs any: a review reads code and never runs tests (jig-review, "Rules for the whole run"). The worktree isolates parallel reviews from each other and from the user's checkout.
2. **Spec**: `node "<root>/bin/jig.mjs" review-cycle spec <refs>` → a path or nothing. A path joins this merge request's focus note as one line `Spec: <path>`. Nothing: the engine looks for the task's spec itself, by the same definition (jig-review `steps/01-prepare.md`, "Spec"): the tasks the merge request names, never a document that only describes the touched area.
3. **Snapshot**: `state=` is a path → copy that file to `<state>.before-cycle`. The tally is checked against the state as it was before the run; afterwards its statuses have already moved.
4. **Plan a re-review, then spawn** role `review-runner`. `state=` a path: read the merge request's target ("Read a merge request" in forge.md), `git -C <worktree> fetch origin <target>`, and from the worktree run `node "<root>/bin/jig.mjs" review-plan origin/<target> --rereview --state <state> --mr`. It is cheap: no subagent, no diff in your context. `re-review scope: unchanged`, `path: inline` or `finders: none` → a fork runner; finders → a fresh runner, since a fork would only plan and return `needs fan-out` ([fork runners](#agent)). The brief: the worktree path, the merge request URL, the focus note (base-check + focus + spec line), the path `<root>/skills/jig-review/SKILL.md`, and for a fork the `prepared:` line. First run or re-review is the engine's own decision, from its state file.
5. **Proof of run**: the first lines are `ran jig-review: yes` and `state: <existing path>`; anything else → the runner failed: never act on its findings, and **continue it, do not restart it**. Its conversation is still there (it stopped on an error, it returned early): message it to go on from where it stopped (Claude Code: `SendMessage` to its id). It is gone, or the agent cannot message a subagent: spawn a new runner with the same brief plus the line `retry: reuse the checkpoint`; jig-review reuses the finder reports the first run saved and spawns only the missing ones ([checkpoint](../jig-review/steps/04-finders.md#checkpoint)). One runner per merge request at a time; a second failure → the merge request is `blocked` with the reason.
6. **Reconcile** before acting on anything: write the tally line to a file, then

   ```bash
   node "<root>/bin/jig.mjs" review-cycle reconcile <state>.before-cycle|none <tally-file>
   ```

   `none` when `state=none`. `OK` → act on the return. `BLOCKED <reason>` (exit 1) → the merge request is `blocked`: nothing posted, nothing resolved, the reason goes to the summary. A degraded run leaves its range unreviewed for the next pass; a degraded **first** run also prints `first run: delete the state file…`: delete the file at `state:` (the engine picks re-review by its existence). A short tally is the one failure no other check sees: findings silently lost their outcome check, and a thread stays open on fixed code for every later pass.
7. **Act on the return**; each bullet names the merge request's outcome:
   - **new findings** → spec hold first when the return's `spec:` line names a file: `node "<root>/bin/jig.mjs" review-cycle spec-hold <state> <that file>` prints the ids of spec findings whose `spec_quote` is not in the spec. They are never posted, never counted as new findings, and listed in the summary for the human. Exit 3 → `blocked`. Then the poster → outcome `returned`, unless every new finding was held.
   - **simplifications only** (`optional` in the tally), out-of-diff findings only, or a `## Deepening` section → the poster still posts the FYI note (the deepening comes from the state); the outcome does not change: the manifest has no thread entry.
   - **outcomes `fixed` / `no_change_needed`** on findings with a `discussion_id` → the poster resolves those threads.
   - **REPLIES** (counter-replies to a dispute that did not hold, answers to a developer's reply, the note that an Important still stands after a new commit) → the poster posts each into its thread → outcome `returned`: the merge request waits on the developer even without new findings.
   - **FYI** (an answer under the FYI note, with the optional items it ticked) → the poster posts it and rebuilds the note; the outcome does not change: optional items never return a merge request.
   - **`skipped` / `unverified` with your note last** and no reply → nothing posted, nothing resolved. Report the `unverified` count.
   - **no new findings and no REPLIES**: after the poster's resolves, `node "<root>/bin/jig.mjs" review-cycle standing <iid>` counts the Important findings of the state still `open` or `skipped` in an open thread. Non-zero → outcome `returned`: the defect stands on the developer's side, whether or not this run had anything to say. Zero, and `node "<root>/bin/jig.mjs" review-cycle unresolved <iid>` prints `0` → outcome `ready`; recommend approval to the human. A non-zero unresolved count → outcome `held`. Exit 3 of either → `blocked`.
   - **dispute: needs a human** (the engine left a dispute to a human) → outcome `held` whatever the bullets above say: the merge request waits on the human, not on the developer. It goes to the summary.
8. **Poster** (role `poster`): the worktree path, the merge request number, the state path, the hold ids or none, the thread ids to resolve, the replies and the FYI answer, the path `<root>/skills/jig-review/references/posting.md`. New findings are never listed: the poster takes them from the state. Before spawning it, note the state's `postable:` line (`node "<root>/bin/jig.mjs" review state <state>`). Its report says `discussion ids written: N/M`; N < M → command it to write the ids back again before teardown: a torn state disables duplicate protection and thread resolution on every later pass. Its manifest entries (M plus the FYI items) fewer than `open without a thread` minus the hold ids → it skipped findings: send it back to post the state's whole postable set.
9. **Teardown** after posting, on every path: `node "<root>/bin/jig.mjs" worktree remove <worktree>` (it unlinks the worktree's links and junctions first, then runs `git worktree remove --force`, so what a seeded link points to in the main checkout survives; never a bare `git worktree remove` or a recursive delete of the folder), then delete `<state>.before-cycle`. The state file itself is never deleted (except after a degraded first run): it is what makes re-reviews converge instead of resampling.

## 3. Verdict, last

After every merge request has run, one call:

```bash
node "<root>/bin/jig.mjs" review-cycle verdict '<refs>=<outcome>' …
```

One argument per merge request processed, skipped or blocked; outcome `returned`, `ready`, `approved` or `held` (`blocked` means `held`). A skipped merge request passes the `outcome=` of its `SKIP` line, never its skip reason: `unchanged` and `stale` can be `returned`. Per ref: any merge request `returned` → `returned`; all `ready` (or approved) → `ready`; all approved → `none`; anything else → no transition. It calls the adapter's `transition` once per ref and prints one line each: the adapter's output, `<ref>: <reason>` for a blocked ref (exit 4), `<ref>: status not recorded, <reason>` for exit 3 (the next pass meets the ref unchanged and records it then).

Then, when any merge request ran a review and the agent keeps subagent transcripts (Claude Code), record the pass's cost from the main checkout: `node "<root>/bin/jig.mjs" review cost --record` (the latest session of the project: this one). Its per-merge-request `$ · $/1k lines · $/thread` go into the summary rows; `jig review cost --report` compares passes and projects. Spawn descriptions follow `<Role> … !<iid>` (`Review !12`, `Post !12`), or the spend is not attributed.

**Only here.** A hand edit between passes (a withdrawn finding, a thread changed at the user's request) never triggers a transition, even when it leaves nothing open: if it would change the verdict, ask the user. **Approval is human-only**: nothing here approves. **CI is not this skill's business**: the forge shows the pipeline, and the human decides what a red one means.

## 4. Summary

One line per merge request that ran a review; skipped ones collapse into one count line.

```
WARNING built-in adapter: gitlab reviewer queue, no tracker spec, verdicts not recorded; …
focus: <first line of the focus note>
[!142](https://…/merge_requests/142) | returned
[!145](https://…/merge_requests/145) | need approval
[!147](https://…/merge_requests/147) | resolved 3 + returned · unverified 1
[!150](https://…/merge_requests/150) | blocked | tally accounts for 1 of 3 standing findings
cost: !142 $11.40 · $7.70/1k lines · $2.20/thread; !147 re-review $9.80
skipped: 7 (approved 1, draft 1, unchanged 2, stale 3)

tracker:
  PROJ-37 → Rework
  PROJ-85: no open merge request, check by hand

spec mismatches (not posted, your call):
  !151 · PROJ-37 · <finding summary>

outside the diff (in the FYI note; a tech-debt issue?):
  !142 · <file> · <finding summary>
```

- **Link**: a markdown link with the text `!<iid>` (rows from several repositories: `<repo>!<iid>`) and the merge request's `web_url` as the target.
- **Status**: `returned` · `need approval` (clean, recommended to the human) · `resolved N` / `resolved N + returned` · `blocked | <reason>`; append `· unverified N` whenever the tally has any, and `· dispute: needs a human` when the engine left one.
- **cost**: from `review cost --record`, one entry per reviewed merge request; omit when the agent keeps no transcripts.
- **skipped**: the `skipped:` line `queue` printed, then `· returned without review: <links>` for the skipped merge requests whose `outcome=` was `returned`: the pass moved their ref with nothing posted. Omit when nothing was skipped.
- **tracker**: every `verdict` line and every `NOTE` from `queue`, verbatim. Omit when empty.
- **WARNING**: the `WARNING` line `queue` printed, verbatim and first. Without it a pass on the built-in queue reads as a pass on the team's.
- **focus**: printed whenever the focus file exists: without it a narrowed pass reads as a full one.
- Nothing processed: one line, `nothing to review: skipped N (…)`, after the `WARNING` line when there is one.

**Language**: the summary and every text you write on the forge follow jig-review's comment language rule (`review.language` of `.jig/review.jsonc`, otherwise the language of the merge request and its threads); the headings above are written in that language too.

## Withdraw a finding

A posted finding the user takes back, from the merge request's repository:

```bash
node "<root>/bin/jig.mjs" review-cycle withdraw <iid> <discussion_id>…
```

Per thread: `DELETED <id> <notes>` (every non-system note was yours, all deleted), `REFUSED <id> <reason>` (someone replied: a human decides), `MISSING <id>`. Findings of deleted or missing threads become `no_change_needed` without a `discussion_id`, after a backup of the state; the next run neither reposts nor rechecks them. A withdrawal is a hand edit: no transition. GitLab only for now; on GitHub it exits 3 saying so.

## Comment bodies

Findings and replies arrive final from jig-review (`<root>/skills/jig-review/steps/07-comments.md` is the rule). Text you write yourself (rare: a resolve note) follows the same rules and language, never mentions CI, pipelines, linters, AI or tools, and goes through a payload file like every body.

## Requirements

`git` and `node` on `PATH`; the forge CLI of the repository, authenticated (`glab` for GitLab, `gh` for GitHub: `jig review-cycle` picks by the `origin` remote, `reviewCycle.forge` in `.jig/config.jsonc` overrides). GitHub support covers the queue, the filter and the unresolved count; withdrawing is GitLab only.
