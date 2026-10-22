---
"jig": patch
---

Agnostic fixes before the first release. A custom check or tool command resolves from the project's `node_modules/.bin` before `PATH`, and Node's own `npm.cmd` and `npx.cmd` resolve on Windows, so `npx …` and locally installed checkers no longer fail with ENOENT. Skills name the plugin root as `${CLAUDE_PLUGIN_ROOT}` or the directory two levels above the skill, so they run under agents that do not set it; `jig-task-status` ships the Codex policy that keeps it user-only, and the build rejects a user-only skill without one. `jig worktree sweep` picks `gh` or `glab` by `reviewCycle.forge` or the GitHub host, the same rule as the review cycle. `jig doctor` shows the Claude Code deny block only in Claude Code or a plain terminal, and recommends `Edit` rules only: Claude Code applies them to `Write` and warns that a `Write` rule never matches.
