---
"jig": minor
---

`/jig-review-cycle`: one pass over every merge request awaiting your review, with `jig review-cycle` for the queue and its filter, the tally check, the unresolved count, the spec hold, withdrawal and the per-ref verdict through a team process adapter (`reviewCycle.processAdapter`). The `jig-review` state file now lives under the main checkout, so a review in a linked worktree shares it.
