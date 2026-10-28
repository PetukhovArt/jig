---
"jig": patch
---

`jig review-cycle queue` prints `SKIP unchanged` for a new head whose diff against the target hashes to the state's `diff_hash`, such as a rebase that moved no patch, instead of sending it to a runner that finds `re-review scope: unchanged`. It fetches the target and the head into the main checkout; a fetch that fails leaves the merge request actionable. (#21)
