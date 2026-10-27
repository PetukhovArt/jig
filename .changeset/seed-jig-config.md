---
"jig": patch
---

`jig worktree seed` copies jig's project config (`.jig/config.jsonc`, `.jig/config.local.jsonc`, `.jig/review.jsonc`) when `.jig/` is ignored in full, so a review worktree plans with the project's `review.jsonc` instead of the defaults.
