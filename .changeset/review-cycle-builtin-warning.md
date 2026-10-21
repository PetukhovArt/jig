---
"jig": patch
---

`jig review-cycle queue` without a configured process adapter prints `WARNING built-in adapter: <forge> reviewer queue, no tracker spec, verdicts not recorded; …` as its first line (and `warning` in `--json`), and the `/jig-review-cycle` summary repeats it, so a pass on the forge's reviewer queue instead of the team's is visible before anything is posted.
