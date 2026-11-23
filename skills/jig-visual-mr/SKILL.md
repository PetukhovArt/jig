---
name: jig-visual-mr
description: "Write or rewrite the description of the current branch's merge request from the jig template: the goal, the reviewer notes, how it works in diagrams, the evidence, then publish it with glab or gh. Use when asked to describe or format a merge request, and from the mr step of every code-changing flow. Not for draft merge requests."
argument-hint: "[<merge request url or number>]"
---

# Visual merge request description

Give the reviewer two things: why the change is needed and how the implementation is shaped. Not a file list: the diff already has one.

1. Read [template.md](template.md). Do not grow the description past it.

2. The repository's merge request standard applies only when `mr.standard` of `.jig/review.jsonc` names it (a path from the repository root: a format document or a PR/MR template; [project config](../jig-review/references/project-config.md) says which file a worktree reads). Set: its required blocks (changelog, ticket link) go at the end, after everything written for the reviewer, unless its validator wants another place; run its local validator before publishing, if it has one. Not set: the description is the template alone.

3. Find the merge request of the current branch ([forge](../jig/references/forge.md), "Merge request of the current branch"; the argument names it when given).
   - Several match the branch: ask which one before touching any of them.
   - None: read `git status --short --branch` and the branch's commits, then create one (forge "Create"). Ask which merge request to take only when the current branch holds no work that belongs to it.

4. Gather only what explains the change.
   - The diff against the target branch, plus enough surrounding code to understand behaviour and ownership.
   - Past ~50 files, do not read the diff whole: build the views from contracts and module boundaries (glossary, ADR, public entry files, files that grew or vanished), and read the diff only where the story needs a detail.
   - The ticket, when the branch, the commits or the task name one.
   - Visual conventions for the diagrams: the `jig-explain` skill.

5. Write the description in the form of [template.md](template.md), all of it in one language: `review.language` of `.jig/review.jsonc` when set, otherwise the language of the repository's recent merge requests. Headings, explanations and diagram node labels are translated; identifiers, paths, commands and names from code stay as they are. Write as one person to another: plain words, no jargon, no filler, domain terms from the project's glossaries.

6. Publish through a temp file ([forge](../jig/references/forge.md)).
   - An existing merge request: read its current description first, so hand edits survive, then "Update the description".
   - A new one: "Create" (`glab` needs `--no-editor --yes`, otherwise it waits in an editor). Not a draft unless the user asked.
   - Read the merge request back and confirm the new description landed. Mermaid renders only on the host: say plainly that you did not see the render.

7. Reply in one line, `MR: <url>  |  Ticket: <key or —>`, then 2 to 3 sentences on what the change does and the decisions behind it.
