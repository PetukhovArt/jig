# jig

jig is a harness plugin for AI coding agents. What code can check, code checks: hooks deny an action before it happens, report findings after an edit and block the end of a turn until the change passes the project's own tools. The model keeps what code cannot check, and jig gives it a thin layer for that: knowledge atoms delivered when they apply, and flows you start explicitly with `/jig`. The core is a single CLI, `bin/jig.mjs` (Node >= 20, no runtime dependencies); the agent connects to it through a thin adapter. v1 ships the Claude Code adapter only.

The harness pyramid: the bottom layers (execution, safety, verification) are durable and get the investment; the top layers (context, orchestration, evolution) get thinner as models absorb them, so jig keeps them small.

| Layer | jig part |
| --- | --- |
| Verification | end-of-turn gate over the project's tsc, ESLint, oxlint, stratum; the agent-view verify check |
| Safety | deny before action: protected paths, suppressions, comments, `--no-verify` |
| Execution | worktree slots (`jig slot`) |
| Context | atoms (`atoms/*.md`) |
| Orchestration | `/jig`, flows, the run page (`jig dash`) |
| Evolution | the journal and the weekly loop (`jig loop`) |

## Install

In Claude Code 2.1.275 or later:

```text
/plugin install jig --marketplace PetukhovArt/jig
```

Or in two steps from a shell:

```text
claude plugin marketplace add PetukhovArt/jig
claude plugin install jig@petukhovart
```

Then run `node <plugin root>/bin/jig.mjs doctor` in your project: it lists the tools jig found and prints anything missing.

## What works without configuration

The hooks run in every project once the plugin is installed:

- **Before an edit or a Bash command** (fails closed): edits to protected paths (`tsconfig*.json`, `eslint.config.*`, `.oxlintrc.json`, `stratum.config.jsonc`, `.jig/config.jsonc`, CI files, `.husky/`), new suppressions (`eslint-disable`, `@ts-ignore`, `@ts-expect-error`, `@ts-nocheck`, `oxlint-disable`, `biome-ignore`, `stratum-ignore`), comments outside the allowed list, and `git commit`/`git push` with `--no-verify` or its equivalents are denied with a one-line reason.
- **After an edit**: atoms whose `paths` match the file (`typescript`, `tests`, `docs`), once per agent; a checklist on the first test file written in a session.
- **At the end of a turn**: if test files changed and no subagent with the `test-reviewer` role ran after the last edit, the turn is blocked.
- **Subagent start**: the subagent gets the index of atoms delivered in the session.

## What needs project configuration

Tool gates switch on by themselves when the project has the tool's config and binary; with neither, the gate stays silent.

| Tool | Config | When it runs |
| --- | --- | --- |
| oxlint | `.oxlintrc.json`, `oxlint.json` or `oxlintrc.json` | after each edit, errors on changed lines |
| stratum | `stratum.config.jsonc` | after each edit and at the end of a turn |
| tsc / vue-tsc | nearest `tsconfig.json` | end of turn, errors in the turn's files only |
| ESLint | `eslint.config.*` or `.eslintrc*` | end of turn, changed lines only |
| agent-view | `agent-view.config.json` | end of turn: a runtime-visible file (`.vue`, `.tsx`, `.css`, ...) changed and no agent-view command ran after it |

`jig check edit <file>` and `jig check stop` run the same paths by hand.

## `/jig` and flows

Without `/jig`, only the hooks and path-matched atoms run, and a small task goes in one shot. `/jig <task>` (fallback `/jig:jig`) is invoked by the user only. It restates the task with a done check, picks a flow, copies the flow's steps into the todo list and opens a run page with `jig dash init`.

Flows (`skills/jig/flows/`): `investigation`, `bug-fix`, `feature`, `interface-design`, `refactoring`, `perf`, `prototype`, `visual-match`, `review`, `bug-bash`, `mr-watching`, `afk-mode`, `session-resume`, `session-pause`. Every code-changing flow ends with the shared `mr` step. Subagent roles are templates in `skills/jig/references/roles/`; each template names a model tier, and `jig tiers` maps it to the agent's models (built-in for Claude Code, overridable in `~/.jig/config.jsonc`).

Other skills: `jig-slots` (model or user), `jig-explain` and `jig-video` (user only).

## Configuration

`.jig/config.jsonc` is optional; without it all rules use their defaults. It holds only rule levels and the `slots` section ([schema](schema/config.schema.json)):

```jsonc
{
  "$schema": "https://raw.githubusercontent.com/PetukhovArt/jig/main/schema/config.schema.json",
  "rules": {
    "jig/comments": "warn",
    "gate/eslint": "off"
  }
}
```

Rules: `jig/comments`, `jig/suppressions`, `jig/protected-paths`, `jig/no-verify`, `jig/test-review`, `jig/verify-fact`, `gate/oxlint`, `gate/stratum`, `gate/tsc`, `gate/eslint`; levels `off`, `warn`, `error`. The agent may not edit this file.

jig creates only `.jig/` in your project: `config.jsonc` goes to git, `journal/`, `runs/` and `cache/` are ignored by `.jig/.gitignore`.

A plugin cannot write permission rules into your project, so add this deny block to `.claude/settings.json` as a second layer. `jig doctor` warns when it is incomplete:

```json
{
  "permissions": {
    "deny": [
      "Edit(.jig/config.jsonc)", "Write(.jig/config.jsonc)",
      "Edit(eslint.config.*)", "Write(eslint.config.*)",
      "Edit(tsconfig*.json)", "Write(tsconfig*.json)",
      "Edit(.oxlintrc.json)", "Write(.oxlintrc.json)",
      "Edit(stratum.config.jsonc)", "Write(stratum.config.jsonc)",
      "Edit(.github/workflows/**)", "Write(.github/workflows/**)",
      "Edit(.gitlab-ci.yml)", "Write(.gitlab-ci.yml)",
      "Edit(.husky/**)", "Write(.husky/**)"
    ]
  }
}
```

## Commands

Run as `node <plugin root>/bin/jig.mjs <command>`.

| Command | What it does |
| --- | --- |
| `check edit <file>` / `check stop` | findings for one file / the end-of-turn gate against HEAD |
| `build [--atoms-only] [--check]` | validates atoms; without `--atoms-only`, writes the tool plan to `.jig/cache/plan.json` |
| `atom <name>` | prints an atom |
| `slot new [--slug <s>] [--branch <b>]` | creates a worktree slot with offset ports and its own `agent-view.config.json` |
| `slot ls [--json]` | slots and their ports |
| `slot rm <N> [--force]` | removes a slot's worktree; without `--force`, refuses on tracked changes |
| `slot sweep [--json]` | sorts all worktrees into `hold-wip`, `hold-open-mr`, `recent`, `safe`; deletes nothing |
| `dash <init\|step\|add\|decision\|result\|ask\|answer\|path>` | the run page under `.jig/runs/<branch>/` |
| `loop [--days 7]` | aggregates the journal into improvement candidates |
| `allow-no-verify` | allows `--no-verify` for one commit within 10 minutes, only when the pre-commit hook fails on files outside the staged change |
| `doctor` | diagnostics: Node, config, found tools, deny block, atom globs, locks |
| `version` | plugin version |

`hook <name>` is the entry point for `hooks/hooks.json`, not for people.

Slots need a `slots` section; `worktreesDir` is required:

```jsonc
{
  "slots": {
    "worktreesDir": "..",
    "install": "npm ci",
    "ports": { "VITE_PORT": { "base": 5173, "step": 10 } },
    "cdp": { "base": 9222, "step": 1 }
  }
}
```

## Agents

v1 supports Claude Code only. The core and its event model do not depend on the agent, so Cursor and Codex adapters can be added later. What each agent offers a plugin (checked October 16, 2026: Claude Code 2.1.300-2.1.301, Codex `6ae8b8a`; "secondhand" means forum reports only):

| Capability | Claude Code | Cursor | Codex CLI |
| --- | --- | --- | --- |
| Root `plugin.json` (Agent Plugins 1.0) | no | skills and MCP only | yes, read first |
| `.claude-plugin/plugin.json` | yes | no | yes, if there is no `.codex-plugin` |
| Hooks in a plugin | `hooks/hooks.json` | only via `.cursor-plugin` | `hooks/hooks.json`, unknown keys rejected |
| Agents in a plugin | yes | only via `.cursor-plugin` | no |
| Skill namespace | `/plugin:skill`, bare name without a collision | none (secondhand) | `plugin:skill` |
| `disable-model-invocation` | yes | yes | no, `agents/openai.yaml` instead |
| `paths` on a skill | yes | yes | no |
| Stop forces continuation | `decision: block` | `followup_message` (up to 5) | `decision: block` |
| Context on prompt submit | yes | no | yes |
| Context after an edit | `PostToolUse` | `postToolUse` only | `PostToolUse` |
| Context on subagent start | yes | no | yes |
| Plugin root path | `${CLAUDE_PLUGIN_ROOT}` | `${CURSOR_PLUGIN_ROOT}` | `CLAUDE_PLUGIN_ROOT` in the environment |

## Evals and benchmarks

Rule fixtures run with the unit tests: `npm test`.

Agent evals are five mini-projects in `evals/agent/` (`bug-fix`, `feature-ui`, `refactor`, `tests`, `review`), run through `claude plugin eval` with and without the plugin. `evals/agent-flow/` holds the same cases prompted with `/jig`.

```text
npm run eval:prepare
claude plugin eval . --case bug-fix --runs 1 --scaffold --allow-tools Write Edit MultiEdit "Bash(*)" --keep-temp
claude plugin eval . --eval-dir evals/agent-flow --scaffold --ablation none --allow-tools Write Edit MultiEdit "Bash(*)"
node evals/summarize.mjs evals/agent/results/<ts> evals/agent-flow/results/<ts>
```

`eval:prepare` installs the mini-project toolchain once into `evals/_toolchain/`. `--scaffold` runs each case's `scaffold.sh` (bash) on your machine. Drop `--case` and `--runs 1` for the full set with three runs per case.

Benchmarks, against your own project:

```text
node bench/hot-path.mjs <project-root> [--runs 200] [--file <relative path>]
node bench/stop-gate.mjs <project-root> [--files 1,5,20] [--runs 3]
node bench/false-positives.mjs <repo>
```

`hot-path.mjs` times `pre-edit` and `post-edit` hooks and reports p50, p95, max, peak RSS and CPU time of the jig process, and the machine CPU load during the runs (target: p95 < 300 ms, RSS < 150 MB). `stop-gate.mjs` plays a turn per run: `session-start`, `user-prompt-submit`, an exported const appended to N tracked `.ts` files (`.vue` with a non-setup `lang="ts"` script as a fallback) with a `post-edit` for each, then the timed `stop` hook. It reports wall time, peak RSS, jig CPU time, machine CPU (which includes tsc and ESLint) and the gate verdict, with the first run apart from the warm ones, and checks the target: stop < 20 s on 1, 5 and 20 files. It refuses files with uncommitted changes and restores their contents after each run and on Ctrl+C. `false-positives.mjs` runs the comment and suppression rules over every tracked `.ts` and `.vue` file as if it were newly added and prints each hit.
