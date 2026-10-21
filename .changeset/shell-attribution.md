---
"jig": minor
---

The end-of-turn gate checks only the session's own changes.

- A file another session or the IDE changed in the same checkout during the turn is no longer checked or blocking; the journal gets a `foreign-change` record.
- Files changed by the session's own `Bash` or `PowerShell` commands still count: new `pre-shell` and `post-shell` hooks diff `git status` around each call. A background command or one with no post event counts until the stop.
- An agent adapter without shell events keeps the previous behaviour: every file that changed during the turn.
