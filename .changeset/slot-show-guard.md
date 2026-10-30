---
"jig": minor
---

`jig slot show` refuses a slot another session looks to be using: HEAD moved by a checkout within the last 2 hours to a different commit (named from the slot worktree's reflog), or a process answering on the slot's dev or CDP ports. `--force` shows anyway, as before.
