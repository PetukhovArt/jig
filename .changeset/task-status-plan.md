---
"jig": minor
---

`jig task-status plan "<step>" ...` declares a run's steps up front as todo. On the page a step with `skip`/`skipped`/`superseded`/`dropped`/`cancelled` is struck and left out of the count, and steps an earlier run left unclosed stay marked with their run. The page is still built once, by `task-status open` at the end of the run or on request.
