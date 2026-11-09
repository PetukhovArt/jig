---
"jig": minor
---

An agent gets the project's `AGENTS.md`, `CLAUDE.md` and `CLAUDE.local.md` for every path it touches (read, search, edit, or a path in a shell command), from that path's repository root down to its directory with their `@path` imports, once per agent and again after a compaction, plus the nearest glossary by path; files the agent loaded by itself are skipped, and an edit of a file whose instructions were never given is denied once with them. This covers a linked worktree outside the session's directory, a file read through the shell, and directories below the launch directory under Codex and Grok. New adapters for Codex CLI (`jig hooks codex --install`) and Grok Build (it runs the plugin's hooks), `jig context <path>` to print what an agent gets, and `evals/context-matrix/matrix.mjs` to check it per agent and layout (#34).
