# Flows, atoms and roles

Without `/jig`, only the hooks run, and a small task goes in one shot. `/jig <task>` (fallback `/jig:jig`) is invoked by the user only. It restates the task with a done check, picks a flow and copies the flow's steps into the todo list. Its rules for evidence, autonomy and questions sit in `skills/jig/SKILL.md` itself, next to the atom index: one line per atom with its trigger, grouped by the moment of work. An atom file is read when a flow step names it or its trigger matches.

Every code-changing flow ends with the shared [`mr`](../skills/jig/flows/mr.md) step: the `jig-review` skill in mode `pre-mr`, UI proof in a slot, `jig pre-mr`, then the merge request. The flow list is in the [README](../README.md#usage).

Subagent roles are templates in `skills/jig/references/roles/`; each template names a model tier and an effort (`metadata.tier`, `metadata.effort`), and `jig tiers` maps the tier to the agent's models (built-in for Claude Code, overridable in `~/.jig/config.jsonc`).

`jig-task-status` keeps the decision trail of a long or unattended run: one TSV row per decision, step or question in `.jig/runs/<branch>/task-status.tsv`, and a page built from it on demand; `afk-mode` follows it.

## Who starts a skill

A skill with `disable-model-invocation: true` runs only when the user types it: the model does not see it in its skill list. jig leaves a skill to the model only when something other than the user must start it.

| skill | started by | why |
| --- | --- | --- |
| `jig` | user | flows are opt-in: without `/jig` a small task goes in one shot; open to the model, it would wrap every task in a flow |
| `jig-init` | user | it writes `.jig/config.jsonc`, the file that decides what gates the model; the session-start line points the user to it |
| `jig-review` | user or model | the `mr` step of every code-changing flow runs it in mode `pre-mr` |
| `jig-review-cycle` | user or model | a schedule (`/loop 2h /jig-review-cycle`, a headless run) fires it without the user |
| `jig-slots` | user or model | flows ask for a worktree or a slot mid-task |
| `jig-task-status` | user | flows that keep a trail (`afk-mode`, `metric-climb`, `custom-flow`) read its file and call `jig task-status` directly; the skill is for the user's own runs |
| `jig-grill` | user | it interviews the user one question at a time; whether to be interviewed is the user's call |
| `jig-prune-comments` | user | it edits every file in its scope with a swarm of agents: the scope and the cost are the user's |
| `jig-explain` | user | it answers a request for a visual explanation; open to the model, it would fire on every "explain" |
| `jig-video` | user | it drives the app and records a narrated video: slow and costly, and only the user knows a demo is wanted |

A new skill takes `disable-model-invocation: true` unless a flow, a role or a schedule must start it, and gets a row here naming that caller.

## Authoring

Flows and role templates carry frontmatter, `name` and a one-line `description`, so an agent sees what each is for without opening it. `npm run build` generates the flow list and the atom index in `skills/jig/SKILL.md`, the role index `skills/jig/references/roles.md` and the collapsed lists of all flows, skills, atoms and roles in the README from it; `jig build` rejects a role or flow mention that names no file and a role no flow or reference spawns. It also rejects a skill whose `name` differs from its folder (Claude Code lists a skill by `name`, Cursor runs it by folder), and a slash command, link or path in the README, `docs/` or a skill that names nothing the plugin ships, including a flow missing from the README flow table.
