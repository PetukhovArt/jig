---
"jig": patch
---

`jig review-cycle queue` no longer marks a merge request `SKIP busy` forever because an empty leftover folder sits at its review worktree path: busy is only a worktree git still has registered (a registered one whose folder is gone is pruned; a non-empty folder git does not know is reported `BLOCKED` and never deleted). `jig worktree remove`, `slot rm` and `worktree sweep` delete the empty top folder git leaves behind on Windows when a process holds it (retrying briefly) and print a warning when it cannot; the review-cycle roles leave the worktree before returning and teardown runs from the main checkout.
