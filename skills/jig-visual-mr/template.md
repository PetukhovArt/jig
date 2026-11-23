# Merge request description form

## Rules

**Remove a block you have nothing for.** No ticket, no warnings: the block goes entirely, no "n/a", so the reviewer reads nothing extra.

**Only what was done.** The description lists the work done and the checks that ran. A skipped step (break-it, UI proof, a check "not run" or "later") is not mentioned. The pre-MR review verdict (Act on, Consider, Noted, Dismissed) stays in the agent's reply and the task-status log, never in the description.

### Budget

A description longer than ~70 lines stops being a description and becomes a second source of truth. Two diagrams and one contract block explain more than five code blocks. Cut type declarations already visible in the diff, pseudocode that repeats a diagram, file trees whose nodes a diagram already names.

### Choice of views

Every view and subheading is optional. Name and order them by the change, not by this list.

- **Two mermaid flowcharts, before and now**: the default start of How it works. Always vertical (`flowchart TD`), even when a view elsewhere is `LR`: a horizontal chain shrinks to the page width until its font is unreadable, a vertical one reads top to bottom. Up to ~7 nodes each; a diagram that needs more hides a second change. Escaped angle brackets and quotes in node labels break the render first.
  `TD` alone does not keep a diagram narrow: mermaid puts the nodes of one level in a row. To keep it vertical and readable:
  - at most two nodes on one level: no node with more than two inputs or two outputs;
  - no arrow back up and no hub that every arrow runs into: such arrows cross the whole width;
  - a node label is a name plus up to ~25 characters of explanation after `<br>`; an edge label is 1 to 3 words; details go in the line of text above the diagram;
  - a read path and a write path (a data flow and a user command) are two linear diagrams, not one.
- **Contract block**: a file format, a protocol format, an SQL table, an endpoint. `diff` for a point change to an existing shape; a plain language block for a new one.
- **Shallow file tree**: only when the change moves ownership between modules and a diagram cannot show it.
- **Pseudocode**: only for behaviour with an important branch no diagram conveys.

## Template

Header (optional): the ticket link, then `  |  ` and the link of the plan or design document.

````markdown
{The ticket link in the short form the tracker renders: `#515`, `PROJ-15`.}

## Goal

{One or at most two sentences: the problem this solves and what becomes possible after release.}

## Reviewer notes

- {1 to 3 warnings for the reviewer: migrations, limits, deliberate omissions or unexpected decisions. None: remove the block.}

## How it works

{The smallest set of views that explains the implementation.}

{One line of context: the old shape.}

```mermaid
flowchart TD
{architecture before this change}
```

{One line of context: the new shape.}

```mermaid
flowchart TD
{architecture after this change}
```

{One line of context.}

```diff|sql|json|typescript
{The changed contract: file or protocol format, SQL table, endpoint request/response, key data structure.}
```

## Evidence

- **Verification:** {how the change was checked, in plain words: dev UI, unit tests, a stand}; **environment:** {where: the app and its build, OS, browser, data}.
- **Before:** {the screenshot, output or test run that failed}
  **After:** {the screenshot, output or the same test, passing}

## Change impact

**Rollback:** {"simple" | "hard" + why: a migration, deleted data, a changed public contract}.
**What can break:** {the screens, scenarios or consumers the merge touches, comma-separated, without a judging word}.

## Test environment

- {Only what the reviewer needs to stand the change up: services with their versions or branches, hosts and ports, configs, the command that starts the app. No scenarios: they live in the ticket.}

{The blocks of the standard `mr.standard` names in `.jig/review.jsonc`, when it is set: at the end, after everything written for the reviewer.}
````
