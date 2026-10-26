---
"jig": patch
---

Agnostic gaps from the pre-release audit (#17):

- The project root comes from `JIG_PROJECT_DIR` under any agent, then the variable the agent's adapter names (Claude Code: `CLAUDE_PROJECT_DIR`), then the git top level.
