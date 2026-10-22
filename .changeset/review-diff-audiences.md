---
"jig": minor
---

`jig review-plan` splits the written diff by audience, so a finder reads only what its angles judge.

- Parts are `code-*`, `tests-*` and `docs-*`; each finder's `diff:` line lists its parts: code for every finder (code is a graph, never cut by angle), tests only for angle 16, documents only for angles 11 and 15.
- `_tests_/` directories count as tests; `testPaths` in `.jig/review.jsonc` adds test globs.
