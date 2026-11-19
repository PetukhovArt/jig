---
"jig": minor
---

`jig-review-cycle` runs each pass in one pass agent (role `review-cycle-pass`): the invoking session only relays the summary, so `/loop 2h /jig-review-cycle` no longer piles every report, plan and tool output of each pass into the looping session. `jig review cost` reports the pass agent as role `pass`.
