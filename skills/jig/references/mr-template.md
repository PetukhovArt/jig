# Merge request description

Give the reviewer two things: why the change is needed and how the implementation is shaped. Not a file list: the diff already has one.

## Rules

- **Language.** `review.language` of `.jig/review.jsonc` ([project config](../../jig-review/references/project-config.md) says which file a worktree reads) when set, otherwise the language of the repository's recent merge requests. All of the description is in it: the template's headings and labels translated, the text, the labels of diagram nodes. Identifiers, paths, commands and names from code stay as they are. Plain words a colleague would use, terms from the nearest glossary, no filler.
- **Remove a block you have nothing for.** No ticket, no warnings: the block goes entirely, no "n/a". Every view under How it works is optional too: pick, name and order them by the change, not by this list.
- **Only what was done.** The description lists the work done and the checks that ran. A skipped step (bug-bash, UI proof, a check "not run" or "later") is not mentioned. The pre-MR review verdict (Act on, Consider, Noted, Dismissed) stays in the agent's reply and the task-status log, never in the description.
- **Budget.** A description longer than ~70 lines stops being a description and becomes a second source of truth. Two diagrams and one contract block explain more than five code blocks. Cut type declarations already visible in the diff, pseudocode that repeats a diagram, file trees whose nodes a diagram already names.
- **Large diff.** Past ~50 files, build the views from contracts and module boundaries (glossary, ADR, public entry files, files that grew or vanished) and read the diff only where the story needs a detail.
- **Repository standard, only when configured.** `mr.standard` of `.jig/review.jsonc` names the repository's merge request standard (a path from the repository root: a format document or a PR/MR template). Set: its required blocks (changelog, ticket link) go at the end, after everything written for the reviewer, unless its validator wants another place; run its local validator before publishing, if it has one. Not set (the default): the description is this template alone.
- **Diagrams.** Mermaid `flowchart TD`, up to ~7 nodes each; a diagram that needs more hides a second change. `TD` stays readable only when it stays narrow:
  - at most two nodes on one level: no node with more than two inputs or two outputs;
  - no arrow back up and no hub that every arrow runs into: such arrows cross the whole width;
  - a node label is a name plus up to ~25 characters of explanation after `<br>`, an edge label 1 to 3 words; details go in the line of text above the diagram;
  - a read path and a write path (a data flow and a user command) are two linear diagrams, not one.
  Escaped angle brackets and quotes in labels break the render first. Mermaid renders only on the host: say plainly that you did not see the render.
- A shallow file tree only when the change moves ownership between modules and a diagram cannot show it. Pseudocode only for behaviour with an important branch no diagram conveys.

## Template

````markdown
{Header, optional: the ticket link in the tracker's short form (`#515`, `PROJ-15`)  |  the plan or design document.}

## Goal

{One or at most two sentences: the problem this solves and what becomes possible after release.}

## Reviewer notes

- {1 to 3 items: a migration, a limit, what is deliberately left out, a decision the reviewer would question and the alternative it beat (a table when there are several).}

## How it works

{The smallest set of views that explains the implementation.}

{One line of context: the old shape.}

```mermaid
flowchart TD
{architecture before}
```

{One line of context: the new shape.}

```mermaid
flowchart TD
{architecture after}
```

{One line of context.}

```diff|sql|json|typescript
{The changed contract: file or protocol format, SQL table, endpoint request/response, key data structure. `diff` for a point change to an existing shape; a plain language block for a new one.}
```

## Evidence

- **Verification level:** {the `Verification level:` line of `jig pre-mr`}.
- {The commands you ran and their output, verbatim or trimmed to the lines that prove the point.}
- {The use cases replayed, by name, with the screenshots of the key screens. Only when the UI proof ran.}
- **Bug-bash:** {bugs found and fixed, what could not be tested and why. Only when bug-bash ran.}
- **Before:** {the screenshot, output or test run that failed}
  **After:** {the same, passing}

## Change impact

**Rollback:** {"simple" | "hard" + why: a migration, deleted data, a changed public contract}.
**What can break:** {the screens, scenarios or consumers the merge touches, comma-separated, without a judging word}.

## Test environment

- {Only what the reviewer needs to stand the change up: services with their versions or branches, hosts and ports, configs, the command that starts the app. No scenarios: they live in the ticket.}

{The blocks `mr.standard` requires, when it is set.}
````
