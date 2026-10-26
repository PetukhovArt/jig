---
"jig": patch
---

Agnostic gaps from the pre-release audit (#17):

- The project root comes from `JIG_PROJECT_DIR` under any agent, then the variable the agent's adapter names (Claude Code: `CLAUDE_PROJECT_DIR`), then the git top level.
- `jig review cost` says it reads Claude Code transcripts only when it finds no session.
- `jig doctor` suggests setting agent-view up only in a project with markup or style files.
- Review step examples name `<deep model>`, `<standard model>` and `<model A> → judge <model B>` instead of Claude model names.
