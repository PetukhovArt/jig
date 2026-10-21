# Flows, atoms and roles

Without `/jig`, only the hooks run, and a small task goes in one shot. `/jig <task>` (fallback `/jig:jig`) is invoked by the user only. It restates the task with a done check, picks a flow and copies the flow's steps into the todo list. Its rules for evidence, autonomy and questions sit in `skills/jig/SKILL.md` itself, next to the atom index: one line per atom with its trigger, grouped by the moment of work. An atom file is read when a flow step names it or its trigger matches.

Every code-changing flow ends with the shared [`mr`](../skills/jig/flows/mr.md) step: the `jig-review` skill in mode `pre-mr`, UI proof in a slot, `jig pre-mr`, then the merge request. The flow list is in the [README](../README.md#usage).

Subagent roles are templates in `skills/jig/references/roles/`; each template names a model tier and an effort (`metadata.tier`, `metadata.effort`), and `jig tiers` maps the tier to the agent's models (built-in for Claude Code, overridable in `~/.jig/config.jsonc`).

`jig-task-status` keeps the decision trail of a long or unattended run: one TSV row per decision, step or question in `.jig/runs/<branch>/task-status.tsv`, and a page built from it on demand; `afk-mode` follows it.

## Authoring

Flows and role templates carry frontmatter, `name` and a one-line `description`, so an agent sees what each is for without opening it. `npm run build` generates the flow list and the atom index in `skills/jig/SKILL.md` and the role index `skills/jig/references/roles.md` from it; `jig build` rejects a role or flow mention that names no file and a role no flow or reference spawns. It also rejects a skill whose `name` differs from its folder (Claude Code lists a skill by `name`, Cursor runs it by folder), and a slash command, link or path in the README, `docs/` or a skill that names nothing the plugin ships, including a flow missing from the README flow table.
