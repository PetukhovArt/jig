---
"jig": minor
---

The merge request description jig writes has a new shape: Goal, Reviewer notes, How it works (before and after diagrams kept narrow by layout rules, the changed contract), Evidence, Change impact, Test environment. A repository's own PR/MR template or format document is added only when `mr.standard` of `.jig/review.jsonc` names it; by default the description is jig's template alone. Its language is `review.language`, the key review comments already use.
