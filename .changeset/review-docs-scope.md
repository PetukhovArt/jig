---
"jig": minor
---

`jig-review` reads fewer documents and narrower code windows.

- Input documents are the rules indexes closest to the changed files (`AGENTS.md`, `CLAUDE.md`), the task's spec or PRD, and the standards. A README, a directory overview, an ADR index or a glossary map is not read whole.
- ADRs: only the ones the diff changes or a rules index links. Glossaries: the changed hunks, and a grep of each new term in the owning glossary, never the whole file.
- Finders read the diff parts listed under their `diff:` only, locate with a numbered search with context, then read at most ~60 lines; no `cat` of whole files, no `sed` ranges of hundreds of lines.
