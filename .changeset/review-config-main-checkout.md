---
"jig": patch
---

`jig review-plan` and `jig review rules` in a linked worktree read `.jig/review.jsonc` from the main checkout when the branch does not track one, so a review worktree created before the config, or seeded with an old copy, no longer plans with the defaults (angles the project turned off came back).
