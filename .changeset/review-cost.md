---
"jig": minor
---

`jig review cost` estimates what a review cost and records it, so passes and projects compare by unit metrics.

- Reads a Claude Code session's subagent transcripts: dollars per role (runner, finder, judge, deepener, outcome, poster) and per merge request, with the merge request's diff lines (code/tests/docs), $ per 1000 lines, posted threads, $ per thread and the cache hit ratio.
- `--record` appends one line per run to `~/.jig/review-cost.jsonl`; `--report [--by project|week]` prints the recorded runs.
- Prices are estimates from `prices` in `~/.jig/config.jsonc`, else built-in list prices. `/jig-review-cycle` records each pass and puts a cost line in its summary; spawn descriptions carry `<Role> … !<iid>`.
