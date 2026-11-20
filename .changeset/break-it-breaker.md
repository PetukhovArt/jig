---
"jig": minor
---

Flow `bug-bash` is now `break-it`: the main session holds the queue of screens and claims and spawns one `breaker` subagent (standard tier, high effort) per entry, which attacks with the action and its checks in one shell call and returns only the reproduced bugs. The attack no longer runs one command per turn on the main session's full context. `jig pre-mr bug-bash` is now `jig pre-mr break-it` and prints a `Break-it:` line; records written by the old command still count.
