---
name: jig-prune-comments
description: "Remove code comments the comments atom does not allow, across a merge request, a folder or the whole repository, with a swarm of cheap agents."
disable-model-invocation: true
argument-hint: "<merge request url or number | folder | repo>"
---

# jig prune comments

Plugin root: `${CLAUDE_PLUGIN_ROOT}` when the agent sets it, otherwise the directory two levels above this file; `jig` means `node ${CLAUDE_PLUGIN_ROOT}/bin/jig.mjs`. Rule: `${CLAUDE_PLUGIN_ROOT}/atoms/comments.md`; read it before step 3.

1. Scope to files: a merge request → the files its diff changes (`${CLAUDE_PLUGIN_ROOT}/skills/jig/references/forge.md`); a folder → `git ls-files <folder>`; `repo` → `git ls-files`. Keep source files only: no generated, vendored, lock or fixture files.
2. Split the files into batches of about 20, grouped by folder. A batch has one owner; no two batches share a file.
3. Spawn one subagent per batch with role `comment-pruner`, prompt beginning `Read ${CLAUDE_PLUGIN_ROOT}/skills/jig/references/roles/comment-pruner.md and follow it.`, then its file list and the atom path. Its tier and effort: `${CLAUDE_PLUGIN_ROOT}/skills/jig/references/roles.md`; the model for the tier: `jig tiers`. At most 5 run at once.
4. Check each returned diff yourself: only comments removed, plus the obvious edits the role allows. Revert anything else in that batch.
5. Take every comment a pruner handed back (it needs a change beyond one function or a signature). For each, decide: fix it in place now, or propose a tracker task tagged `tech_debt` with the file, the comment and the change it calls for. Create no task before the user says yes to it.
6. Run the project's type check and tests on the touched files. A failure: revert the edit that caused it and hand that comment to step 5.

Reply: files scanned, comments removed, obvious fixes made, comments fixed in place, proposed `tech_debt` tasks (file, comment, the change), checks run with their result.
