---
"jig": minor
---

A merge request whose posted Important still stands goes back to the developer instead of hanging in review. A re-review after a commit that left the defect in place answers once in its thread (``after `<sha>` the defect stands: <line>``), and its outcome is `returned`; `jig review-cycle standing <mr>` counts such findings. `jig review-cycle queue` prints `outcome=` on every `SKIP` line: `unchanged` and `stale` with a standing Important are `returned`, the rest `held`. A developer reply no longer lets a merge request be skipped as stale. An answer under the FYI note, or a new commit, rechecks the optional items, and the note ticks the done ones.
