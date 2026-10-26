---
"jig": patch
---

Re-reviews in a review cycle cost what their new work costs. `jig review-plan <base> --rereview --state <path>` takes the scope from per-file patches against the base, so a base merged into the branch or a force-push counts only the branch's own changes, and prints a `re-review scope:` line; the cycle runs it before spawning and forks a runner only for an inline re-review. The poster always posts the state's whole postable set, whatever replies its brief lists, and `jig review state` prints that set as a `postable:` line the cycle checks the poster's report against. (#19)
