---
"jig": patch
---

Skill snippets no longer need bash. `jig review rules [<base>]` prints the rules indexes on the walk up from the changed files, the standard documents and the architecture documents (paths with spaces included), replacing the `xargs`/`while read` walk and the `grep` searches; `jig review-plan --state` replaces the hash and per-file patch loops of a re-review. `mermaid-ascii` reads a file, forge bodies are written with the agent's file-write tool with the PowerShell form given, the CLI path is quoted (`node "<root>/bin/jig.mjs"`), and `docs/agents.md` says what remains POSIX shell. (#16)
