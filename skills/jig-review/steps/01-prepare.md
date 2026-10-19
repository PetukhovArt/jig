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

The source of the diff's goal for [angle 15](../angles/15.spec.md). Angle 15 not selected: no search. `discover.spec: false` turns the search off; `discover.tracker: true` allows fetching issues. Search in this order, the first found wins:

1. issue references in the commits of the range (`#123`, `Closes #45`, `!67`) and in the merge request description → the issue with its comments (the comments matter for [`spec_quote`](../angles/15.spec.md#spec_quote));
2. a path given in the focus note;
3. a spec file in the repository that matches the branch or feature: `docs/`, `specs/`, `*SPEC.md`, `*prd.md`.

The merge request description is only a source of references for item 1: the author of the diff writes it, and a mismatch between it and the code is documentation drift, not a spec finding. Nothing found: angle 15 does not run, the summary says `spec: not found`. Do not ask the user: a spec is not a precondition of a review. The text found goes **only into the personal tail of the finder that carries angle 15**, never into the shared prefix.

## Layout

```bash
node <root>/bin/jig.mjs review-plan <base> [--selector <selector>] [--spec] [--mode pre-mr] [--mr] [--no-state]
```

`--spec` when a spec was found. `--mode pre-mr` in mode `pre-mr`. `--mr` in mode `review` when a merge request is known: it turns state, comment texts, re-review and posting on. `--no-state` passes the flag of the same name. No selector argument: pass none; the command picks the default. It prints, and with `--json` returns as data:

- `LINES`: added + removed lines by `git diff --numstat -M` against the merge base, without tests, fixtures and `*.md`. A rename without edits counts 0. Documents are judged by angle 11 and add no readers to the bug finders.
- `N = ceil(LINES / 150)`, at most 5. `N = 1`: `path: inline`, you review in this session ([inline](04-inline.md)), on `quick` unless a selector was given. `N > 1`: up to four bug finders plus cleanup; the rules finder and the tests-and-comments finder come on top of `N` when the diff shape calls for them.
- the diff shape (tests, added comments, Markdown, new source files, spec), the selector expanded (`auto` too), the mode and whether state is on, every finder (or the inline reader) with its angles, tier, effort and model and the absolute paths of its angle files (`read:`) and atoms (`atoms:`), the judge model per finder model, the subagent cap, and the angles skipped with the reason;
- last, **the steps for this run**: the files to read from here on, in order. Only those apply.

The printed layout is the plan; do not recompute it by hand. No caps on the number of findings: whatever survives the gates reaches the author.
