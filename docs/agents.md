# Agents

v1 supports Claude Code only. The core and its event model do not depend on the agent: the CLI `bin/jig.mjs` (Node >= 20, no runtime dependencies) takes hook events through a thin adapter, so Cursor and Codex adapters can be added later.

The project root is `JIG_PROJECT_DIR` when set, else the variable the agent sets (Claude Code: `CLAUDE_PROJECT_DIR`; each adapter names its own), else the git top level of the working directory.

## The harness pyramid

The bottom layers (execution, safety, verification) are durable and get the investment; the top layers (context, orchestration, evolution) get thinner as models absorb them, so jig keeps them small.

| Layer | jig part |
| --- | --- |
| Verification | checks after an edit and at the end of a turn over the tools named in `.jig/config.jsonc` (tsc, ESLint, oxlint, stratum, the project's own `checks`); UI proof before the merge request (`jig pre-mr`, agent-view for now) |
| Safety | deny before an edit: suppressions always, new comments and new test cases once with their rules |
| Execution | feature worktrees (`jig worktree`) and slots with a warm dev server (`jig slot`) |
| Context | atoms (`atoms/*.md`), indexed in `skills/jig/SKILL.md` |
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
