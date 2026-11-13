---
"jig": minor
---

OpenCode support: `jig hooks opencode --install` adds a plugin that runs jig's hooks inside OpenCode (deny before an edit or a shell command, context after a tool, on a prompt and at session start, the stop check when a session goes idle), and an `opencode` adapter that knows which `AGENTS.md`/`CLAUDE.md` files OpenCode loads by itself.
