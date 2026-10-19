# jig

[![CI](https://github.com/PetukhovArt/jig/actions/workflows/ci.yml/badge.svg)](https://github.com/PetukhovArt/jig/actions/workflows/ci.yml) [![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE) [![node](https://img.shields.io/badge/node-%3E%3D20-339933.svg)](package.json) [![Claude Code plugin](https://img.shields.io/badge/Claude_Code-plugin-D97757.svg)](.claude-plugin/plugin.json)

jig is a harness plugin for AI coding agents. What code can check, code checks: hooks deny an edit before it is written, report findings after an edit and block the end of a turn until the change passes the project's own tools, and `jig pre-mr` holds the merge request until a UI change is proven on the running app. The model keeps what code cannot check, and jig gives it a thin layer for that: knowledge atoms read when their trigger applies, and flows you start explicitly with `/jig`. The core is a single CLI, `bin/jig.mjs` (Node >= 20, no runtime dependencies); the agent connects to it through a thin adapter. v1 ships the Claude Code adapter only.

The harness pyramid: the bottom layers (execution, safety, verification) are durable and get the investment; the top layers (context, orchestration, evolution) get thinner as models absorb them, so jig keeps them small.

| Layer | jig part |
| --- | --- |
| Verification | checks after an edit and at the end of a turn over the tools named in `.jig/config.jsonc` (tsc, ESLint, oxlint, stratum, the project's own `checks`); UI proof before the merge request (`jig pre-mr`, agent-view for now) |
| Safety | deny before an edit: suppressions always, new comments and new test cases once with their rules |
| Execution | feature worktrees (`jig worktree`) and slots with a warm dev server (`jig slot`) |
| Context | atoms (`atoms/*.md`), indexed in `skills/jig/SKILL.md` |
| Orchestration | `/jig`, flows, review (`jig-review`, `jig review-plan`), the decision trail (`jig task-status`) |
| Evolution | the journal and the weekly loop (`jig loop`) |

## Quick start

In Claude Code:

```text
/plugin install jig --marketplace PetukhovArt/jig
/jig-init
/jig <task>
```

`/jig-init` starts from `jig init`, which discovers the tools by the jig catalog and writes nothing; the skill then asks what code cannot know, writes `.jig/config.jsonc` and runs `jig doctor`. `jig init` on a Vue demo project:

```text
jig init: discovery by the jig catalog; nothing is written.

found:
  tsc          ready; markers tsconfig.json; packages typescript; binary not installed
  eslint       ready; markers eslint.config.mjs; packages eslint; binary not installed
  agent-view   ready; markers agent-view.config.json; binary C:\Program Files\nodejs\node.exe C:\Users\me\AppData\Roaming\npm\node_modules\@petukhovart\agent-view\dist\cli\index.js
not found: oxlint, stratum
eslint-plugin-boundaries: absent

ask the user (code cannot know):
  - App run command (slots.dev) and install command (slots.install), if the project runs an app.
  - agent-view for UI proof (configured): needed? Setup: agent-view init.
  - stratum for module layers (not installed): needed? Setup: stratum-lint init, then stratum-lint baseline.

proposal for .jig/config.jsonc:
{
  "$schema": "https://raw.githubusercontent.com/PetukhovArt/jig/main/schema/config.schema.json",
  "tsc": {},
  "eslint": {},
  "agent-view": {}
}
```

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

Then run `/jig-init` in your project, or `node <plugin root>/bin/jig.mjs doctor` to see the config, each catalog tool and anything missing.

## What works without configuration

The hooks run in every project once the plugin is installed:

- **Before an edit** (fails closed): a new suppression directive of ESLint, oxlint, Biome, TypeScript or stratum is always denied; fix the cause, only a human adds one. An edit that adds a comment or a test case is denied once with the rules: the full `comments` or `tests` atom the first time per agent and after each compaction, a one-line reminder later. The same call passes on retry, and removing a comment or a test never stops. Tool directives a build needs (`/// <reference>`, `@vite-ignore`, webpack magic comments, `__PURE__`) are not comments for the gate.
- **After an edit**: the edit-time tools and `checks` from the config report findings on the file.
- **End of turn**: the heavy tools and `checks` from the config run over the turn's files and block the turn on an error, the chain stopping at the first failing tool.
- **Session start**: one line when the config is invalid or the project drifted from it (a tool found but not named, a named tool without its binary), pointing to `jig init`, or `jig init --update` when a config exists.

The comment gate is on by default; a project turns it off with `"jig/comments": "off"` (suppressions stay denied), and the test gate with `"jig/tests": "off"`.

## What needs project configuration

At runtime jig reads only `.jig/config.jsonc` and `.jig/config.local.jsonc`; a tool runs only when the config names it, so without a config no tool runs. `jig init` proposes the entries from the markers it finds. Each tool resolves its marker config from the edited file upward, so a monorepo package uses its own.

| Tool | Marker config | When it runs |
| --- | --- | --- |
| `oxlint` | `.oxlintrc.json`, `oxlint.json` or `oxlintrc.json` | after each edit, errors on changed lines |
| `stratum` | `stratum.config.jsonc` | after each edit and at the end of a turn |
| `tsc` (or `"command": "vue-tsc"`) | nearest `tsconfig.json` | end of turn, errors in the turn's files only |
| `eslint` | `eslint.config.*` or `.eslintrc*` | end of turn, errors on changed lines only |
| `agent-view` | `agent-view.config.json` | `jig pre-mr`: UI proof before the merge request |

`jig check edit <file>` and `jig check stop` run the same paths by hand.

## UI proof before the merge request

The `mr` step runs `jig pre-mr [<base>]`, which diffs the branch against its base. A UI file needs proof kinds: `behavior` (the use case still works) and `look` (what the user sees). For agent-view, components and markup (`.vue`, `.tsx`, `.jsx`, `.svelte`, `.html`, not tests) need both, styles (`.css`, `.scss`, `.less`) need `look`. `jig pre-mr proof "<command>"` runs the command and records the proof when it exits 0: only `agent-view act replay` proves `behavior`, only `agent-view screenshot` or `snap` proves `look`; other commands are refused. A proof counts when no UI file it covers changed after it. A branch that touches UI also needs a bug-bash record: `jig pre-mr bug-bash "<bugs found and fixed, what could not be tested>"`. Without them `jig pre-mr` lists what is missing and exits 1.

When the proof cannot run, `jig skip-verify --level unit-test|type-check|none --why "<reason>"` lets `jig pre-mr` pass until the next edit; the level goes to the journal and into the merge request description.

## `/jig` and flows

Without `/jig`, only the hooks run, and a small task goes in one shot. `/jig <task>` (fallback `/jig:jig`) is invoked by the user only. It restates the task with a done check, picks a flow and copies the flow's steps into the todo list. Its rules for evidence, autonomy and questions sit in `skills/jig/SKILL.md` itself, next to the atom index: one line per atom with its trigger, grouped by the moment of work. An atom file is read when a flow step names it or its trigger matches.

Flows (`skills/jig/flows/`): `investigation`, `diagnose`, `bug-fix`, `feature`, `module-design`, `refactoring`, `perf`, `metric-climb`, `prototype`, `ui-match`, `bug-bash`, `custom-flow`, `eval`, `mr-watching`, `afk-mode`, `session-resume`, `session-pause`. Every code-changing flow ends with the shared `mr` step: the `jig-review` skill in mode `pre-mr`, UI proof in a slot, `jig pre-mr`, then the merge request. Subagent roles are templates in `skills/jig/references/roles/`; each template names a model tier and an effort (`metadata.tier`, `metadata.effort`), and `jig tiers` maps the tier to the agent's models (built-in for Claude Code, overridable in `~/.jig/config.jsonc`).

Flows and role templates carry frontmatter, `name` and a one-line `description`, so an agent sees what each is for without opening it. `npm run build` generates the flow list and the atom index in `skills/jig/SKILL.md` and the role index `skills/jig/references/roles.md` from it; `jig build` rejects a role or flow mention that names no file and a role no flow or reference spawns.

Other skills:

| Skill | Invoked by | What it does |
| --- | --- | --- |
| `jig-review` | model or user | reviews a diff with finders, a separate judge and proven findings; mode `review` for someone else's merge request (threads, `--post`, re-review), mode `pre-mr` for your own diff before the merge request; `jig review-plan` prints the finder layout |
| `jig-slots` | model or user | a feature worktree per task, and finished branches shown in a slot with a warm dev server on offset ports |
| `jig-init` | user | discovery by the catalog, questions code cannot answer, an explicit `.jig/config.jsonc`, agent-view and stratum setup, `jig doctor` |
| `jig-task-status` | user | the decision trail of a long or unattended run |
| `jig-grill` | user | interviews you about a plan or a decision, one question at a time |
| `jig-prune-comments` | user | removes comments the `comments` atom does not allow across a merge request, a folder or the repo, with a swarm of cheap agents |
| `jig-explain` | user | explains the current topic visually |
| `jig-video` | user | records a narrated demo video of a change's use cases |

`jig-task-status` keeps the decision trail of a long or unattended run: one TSV row per decision, step or question in `.jig/runs/<branch>/task-status.tsv`, and a page built from it on demand; `afk-mode` follows it.

## Configuration

`.jig/config.jsonc` names what runs ([schema](schema/config.schema.json)); `.jig/config.local.jsonc`, outside git, is laid over it: objects merge key by key, `checks` merge by name, any other value replaces the shared one.

```jsonc
{
  "$schema": "https://raw.githubusercontent.com/PetukhovArt/jig/main/schema/config.schema.json",
  "rules": { "jig/comments": "off" },
  "tsc": { "command": "vue-tsc" },
  "eslint": { "ignoreRules": ["boundaries/*"] },
  "oxlint": false,
  "agent-view": {},
  "checks": [
    { "name": "i18n-keys", "files": ["src/**/*.vue", "src/**/*.ts"], "on": "stop", "run": "node scripts/check-i18n.mjs {files}" }
  ]
}
```

- `rules`: `jig/comments` and `jig/tests`, levels `off`, `warn`, `error` (default `error`); any level but `off` keeps the gate on.
- A catalog name (`oxlint`, `tsc`, `eslint`, `stratum`, `agent-view`) turns that tool on; `false` turns it off. Its settings: `level`, `command`, `ignoreRules`. A name outside the catalog is an unknown key.
- `checks`: the project's own commands, run after an edit (`"on": "edit"`) or at the end of a turn (`"on": "stop"`) on the files matching `files` (a glob or a list). `run` needs the `{files}` token, which becomes one argument per file; `format` reads the output (`exit` by default: a non-zero exit is one finding; `jsonl`, or a tool name for its parser); `level` as for rules. Findings carry the rule `check/<name>`.
- `slots` and `worktree`: see [Commands](#commands).

jig creates only `.jig/` in your project: `config.jsonc` goes to git, `config.local.jsonc`, `journal/`, `runs/` and `cache/` are ignored by `.jig/.gitignore`.

jig does not guard config files itself. A plugin cannot write permission rules into your project, so add this deny block to `.claude/settings.json`; `jig doctor` warns when it is incomplete:

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
| `build [--atoms-only] [--check]` | validates atoms, role templates and flows; without `--atoms-only`, writes the tool plan to `.jig/cache/plan.json` |
| `atom <name>` | prints an atom |
| `init [--update] [--json]` | discovery by the catalog: found tools, what to ask the user, a proposed `.jig/config.jsonc` (with `--update`, the current config plus what it does not name); writes nothing |
| `slot new [--slug <s>] [--branch <b>]` | creates a slot worktree with offset ports and its own `agent-view.config.json`, seeded from the main checkout |
| `slot show <N> <branch\|commit>` | checks the branch out detached in slot N (refuses on tracked changes) and runs the install command when a lock file changed |
| `slot ls [--json]` | slots and their ports |
| `slot rm <N> [--force]` | removes a slot's worktree; without `--force`, refuses on tracked changes |
| `worktree seed <dir>` | copies the main checkout's ignored files and recreates its ignored symlinks in another worktree; never overwrites tracked files |
| `worktree sweep [--json] [--ask] [--yes <path\|slot>]...` | sorts every worktree but the main checkout into `hold-current`, `hold-locked`, `hold-wip`, `hold-open-mr`, `prunable`, `recent`, `safe`; removes only those confirmed at the `--ask` prompt or named by `--yes`, never a `hold-current`, `hold-locked` or `hold-wip` one |
| `review-plan [<base>] [--selector full\|quick\|auto\|<tokens>] [--spec] [--agent <id>] [--json]` | the review layout for the diff against the base: counted lines, finders, their models and the judge |
| `pre-mr [<base>]` | exit 0 when the branch's UI changes are proven or skipped with a level, else lists what is missing and exits 1 |
| `pre-mr proof "<command>"` / `pre-mr bug-bash "<result>"` | runs a proof command and records it when it exits 0 / records the bug-bash result |
| `skip-verify --level unit-test\|type-check\|none --why "<reason>"` | lets `pre-mr` pass with that level until the next edit |
| `task-status log <phase> <decision> [--why <text>] [--evidence <text>] [--result <text>]` | appends a row to the decision journal `.jig/runs/<branch>/task-status.tsv` |
| `task-status open [--lang en\|ru]` / `task-status path` | builds the HTML page from the journal and prints its path / prints the journal path |
| `tiers [--agent <id>] [--json]` | the models of each tier for the agent |
| `loop [--days 7]` | aggregates the journal into improvement candidates |
| `doctor` | diagnostics: Node, config, each catalog tool, agent-view setup, deny block, journal size, locks |
| `version` | plugin version |

`hook <name>` is the entry point for `hooks/hooks.json`, not for people.

Slots need a `slots` section; `worktreesDir` is required. The `worktree` section tunes seeding: `seedExclude` skips ignored paths, `copyFiles` adds files inside ignored folders:

```jsonc
{
  "slots": {
    "worktreesDir": "..",
    "install": "npm ci",
    "ports": { "VITE_PORT": { "base": 5173, "step": 10 } },
    "cdp": { "base": 9222, "step": 1 }
  },
  "worktree": { "seedExclude": ["coverage"] }
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

Where `claude plugin eval` cannot run Bash cases (Windows without its sandbox), `evals/run-local.mjs` runs the same case files with plain `claude -p`:

```text
node evals/run-local.mjs --plugin . --case bug-fix --runs 1 --keep-temp
node evals/run-local.mjs --plugin . -j 3
node evals/run-local.mjs --plugin . --eval-dir evals/agent-flow -j 3
```

It runs `scaffold.sh` with Git Bash in a fresh temp dir, then the prompt with `--plugin-dir` (arm `with`) or without it (arm `without`; `evals/agent-flow` runs `with` only). Both arms skip your own setup: user settings, hooks, plugins, MCP servers, `CLAUDE.md` and auto-memory. `regex` and `llm` graders (judge: `--judge-model`, haiku by default) score each run. It writes per-run JSON, the stream-json traces, `aggregate-result.json` for `summarize.mjs` and `summary.md` into `<eval dir>/results/local-<ts>/` (or `--out`). It stops launching runs when the account's rate limit utilization reaches `--stop-at-utilization` (default 0.98).

`eval:prepare` installs the mini-project toolchain once into `evals/_toolchain/`. `--scaffold` runs each case's `scaffold.sh` (bash) on your machine. Drop `--case` and `--runs 1` for the full set with three runs per case.

Benchmarks, against your own project:

```text
node bench/hot-path.mjs <project-root> [--runs 200] [--file <relative path>]
node bench/stop-gate.mjs <project-root> [--files 1,5,20] [--runs 3]
node bench/false-positives.mjs <repo>
```

`hot-path.mjs` times `pre-edit` and `post-edit` hooks and reports p50, p95, max, peak RSS and CPU time of the jig process, and the machine CPU load during the runs (target: p95 < 300 ms, RSS < 150 MB). `stop-gate.mjs` plays a turn per run: `session-start`, `user-prompt-submit`, an exported const appended to N tracked `.ts` files (`.vue` with a non-setup `lang="ts"` script as a fallback) with a `post-edit` for each, then the timed `stop` hook. It reports wall time, peak RSS, jig CPU time, machine CPU (which includes tsc and ESLint) and the gate verdict, with the first run apart from the warm ones, and checks the target: stop < 20 s on 1, 5 and 20 files. It refuses files with uncommitted changes and restores their contents after each run and on Ctrl+C. `false-positives.mjs` runs the comment and suppression rules over every tracked `.ts` and `.vue` file as if it were newly added and prints each hit.
