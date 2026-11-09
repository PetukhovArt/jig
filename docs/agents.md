# Agents

The core and its event model do not depend on the agent: the CLI `bin/jig.mjs` (Node >= 20, no runtime dependencies) takes hook events through a thin adapter per agent (`hook <name> --agent claude|codex|grok`; without the flag the agent is told by its environment). Adapters exist for Claude Code, Codex CLI and Grok Build; Cursor needs one.

- **Claude Code**: the plugin's `hooks/hooks.json`.
- **Grok Build** reads the same plugin hooks from the Claude Code install, from the copy Claude Code keeps in its plugin cache (`installPath` in `~/.claude/plugins/installed_plugins.json`), not from a directory marketplace's source: after changing a local checkout, `claude plugin update jig@<marketplace>` refreshes that copy. A headless run needs `--trust` for the project's instructions and hooks, an interactive one `/hooks-trust` once per project.
- **Codex CLI** does not run a Claude plugin's hooks: `jig hooks codex --install` writes jig's entries into `$CODEX_HOME/hooks.json` (default `~/.codex`), marked `_jigManaged`, next to the user's own; `--uninstall` removes only them, and the bare command prints them. Codex asks to trust them once in `/hooks` (`codex exec --dangerously-bypass-hook-trust` for automation). Codex sets no project directory variable, so the session's root is the git top level of its directory at session start, kept for later hooks of that session.

Which instruction files each agent loads by itself, which jig adds per touched path, and the matrix that checks it: [hooks](hooks.md) and [evals](evals.md).

The deterministic parts of the skills are `jig` commands, which run in any shell. What remains as a shell snippet (forge calls, `git` one-liners) is written for a POSIX shell, which Claude Code on Windows provides as Git Bash; a skill gives the PowerShell form where it differs. Paths to the CLI are quoted (`node "<root>/bin/jig.mjs"`), so a plugin root with a space works.

The project root is `JIG_PROJECT_DIR` when set, else the variable the agent sets (Claude Code and Grok: `CLAUDE_PROJECT_DIR`), else the git top level of the session's starting directory.

## The harness pyramid

The bottom layers (execution, safety, verification) are durable and get the investment; the top layers (context, orchestration, evolution) get thinner as models absorb them, so jig keeps them small.

| Layer | jig part |
| --- | --- |
| Verification | checks after an edit and at the end of a turn over the tools named in `.jig/config.jsonc` (tsc, ESLint, oxlint, stratum, the project's own `checks`); UI proof before the merge request (`jig pre-mr`, agent-view for now) |
| Safety | deny before an edit: suppressions always, new comments and new test cases once with their rules |
| Execution | feature worktrees (`jig worktree`) and slots with a warm dev server (`jig slot`) |
| Context | atoms (`atoms/*.md`), indexed in `skills/jig/SKILL.md`; the project's `AGENTS.md`/`CLAUDE.md` chain for each path the agent touches ([hooks](hooks.md)) |
| Orchestration | `/jig`, flows, review (`jig-review`, `jig review-plan`), the decision trail (`jig task-status`) |
| Evolution | the journal and the weekly loop (`jig loop`) |

## What each agent offers a plugin

Checked October 16, 2026: Claude Code 2.1.300-2.1.301, Codex `6ae8b8a`; "secondhand" means forum reports only.

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

Checked November 10, 2026 for project instructions: Claude Code 2.1.321, Codex CLI 0.167.0, Grok Build 1.0.77. A jig Codex plugin installed from a local marketplace ran none of its hooks; the user-level `hooks.json` does.

| Instruction files | Claude Code | Codex CLI | Grok Build |
| --- | --- | --- | --- |
| At start | `CLAUDE.md`, `CLAUDE.local.md` from the launch directory up, with `@path` imports; `AGENTS.md` instead when there is none | one `AGENTS.override.md` or `AGENTS.md` per directory, git root to launch directory | `AGENTS.md`, `CLAUDE.md`, `CLAUDE.local.md`, git root to launch directory, in a trusted folder only |
| Below the launch directory | on `Read` of a file there; `InstructionsLoaded` reports `CLAUDE.md` and imports | not loaded; the prompt asks the model to look | not loaded; the model is told the paths |
| Outside the launch directory (a sibling worktree) | not loaded | not loaded | not loaded |
| Deny with a reason the model reads | `PreToolUse` `permissionDecision` | `PreToolUse` `permissionDecision` | `PreToolUse` `permissionDecision` |
| Context after a tool | `PostToolUse` `additionalContext`, over 10,000 characters saved to a file | `PostToolUse` `additionalContext`, about 2,500 tokens | `PostToolUse` `additionalContext` |
| Edit tool name | `Edit`, `Write`, `MultiEdit`, `NotebookEdit` | `apply_patch`, the patch text in `tool_input.command` | Claude Code names |
