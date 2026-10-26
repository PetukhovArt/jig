---
"jig": patch
---

The end-of-turn gate no longer passes when a check did not finish. A tool or check that times out, crashes or runs out of the shared budget blocks the turn once with `gate/incomplete`, naming the tool, and `jig check stop` prints an `incomplete:` line and exits 3 instead of `clean`. Each tool and check takes a `timeout` in seconds, and eslint's default grows by a second per file. (#6)
