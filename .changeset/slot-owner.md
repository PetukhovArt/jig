---
"jig": minor
---

`jig slot show` records the session that showed last as the slot's owner (in the slot's git dir) and refuses a slot another owner showed to in the last 2 hours, or one a plain `git checkout` moved; the same session is never refused. The owner is `--owner <id>`, the agent's session variable, or the first non-shell ancestor process. `--force` takes the slot over; new `jig slot release <n>` clears the owner.
