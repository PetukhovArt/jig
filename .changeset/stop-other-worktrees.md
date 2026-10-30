---
"jig": patch
---

The end-of-turn gate skips files inside another linked worktree under the project, such as a background subagent's `.claude/worktrees/agent-<id>/`, so its unfinished edits no longer block the main session's turn (#30).
