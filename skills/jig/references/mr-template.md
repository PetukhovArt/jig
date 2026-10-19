# Merge request description

Give the reviewer two things: why the change is needed and how the implementation is shaped. Not a file list: the diff already has one.

## Rules

- **Remove a block you have nothing for.** No ticket, no trade-offs: the block goes entirely, no "n/a".
- **Budget.** A description longer than ~70 lines stops being a description and becomes a second source of truth. Two diagrams and one contract block explain more than five code blocks. Cut type declarations already visible in the diff, pseudocode that repeats a diagram, file trees whose nodes a diagram already names.
- **The project's own standard wins.** Read the repository's merge request standard if it has one (`CONTRIBUTING.md`, a PR/MR template, a line in `AGENTS.md`). Its required blocks (changelog, ticket link) must be there or CI blocks the merge; put them at the end, after everything written for the reviewer, unless its validator wants another place. Run its local validator before publishing, if it has one.
- **Diagrams.** Mermaid `flowchart TD` (vertical: a horizontal chain shrinks to unreadable width), up to ~7 nodes each; a diagram that needs more hides a second change. Avoid escaped angle brackets and quotes in node labels: they break the render first. Mermaid renders only on the host: say plainly that you did not see the render.
- A shallow file tree only when the change moves ownership between modules and a diagram cannot show it. Pseudocode only for behaviour with an important branch no diagram conveys.

## Template

````markdown
{Ticket link in the tracker's short form: `#515`, `PROJ-15`.}

## Why

{One or at most two sentences: the problem this solves and what becomes possible after release.}

## What changed

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

```diff|sql|json|typescript
{The changed contract: file or protocol format, SQL table, endpoint request/response, key data structure. `diff` for a point change to an existing shape; a plain language block for a new one.}
```

## Scope

{What is in this merge request and what is deliberately left out; 1 to 3 warnings for the reviewer: migrations, limits, intentional gaps.}

## Trade-offs

{The alternatives you considered and why this one; a table when there are several.}

## Change impact

**Rollback:** {"simple" | "hard" + why: a migration, deleted data, a changed public contract}.
**What can break:** {screens, scenarios or consumers the merge touches, comma-separated}.
**Safe because:** {the one fact the change is safe because of, and how you proved it}.

## Verification

- {The commands you ran and their output, verbatim or trimmed to the lines that prove the point.}
- {The use cases replayed, by name, with the screenshots of the key screens.}
- **Bug-bash:** {bugs found and fixed, what could not be tested and why} | {"UI not touched"}.
- **Verification level:** {"full" when `jig pre-mr` passed | the `jig skip-verify` level and its reason}.
- **Before:** {the screenshot, output or test run that failed}
  **After:** {the same, passing}

{Changelog or any other block the repository's own standard requires.}
````
