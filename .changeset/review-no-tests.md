---
"jig": minor
---

A review never runs tests, builds or installs: a claim only a test would settle is not proven. `/jig-review-cycle` seeds its worktrees without dependencies and no longer passes a `tests:` line to the runner. `jig worktree seed --link-deps` is removed: the review cycle was its only user.
