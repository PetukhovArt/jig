---
"jig": minor
---

`jig-review` reads its shared context once and a failed run continues instead of restarting.

- `jig review-plan` writes the diff once when the layout has finders: parts of at most 1500 lines under `.jig/runs/review/diff-<hash>/`, each file whole, with an `index.txt` of line ranges, printed as `diff files:` (`diffFiles` in `--json`). Finders read the parts and judges their files' ranges; nobody runs `git diff` on the reviewed range again.
- The orchestrator reads the code around the diff once and passes it as an `already read` list. Where the agent can fork (Claude Code), a subagent on the orchestrator's own model is forked and starts from the prompt cache; others are spawned fresh with byte-identical briefs.
- Finders, deepener and judges run in the foreground, so their reports reach the agent that spawned them, never the review cycle's session.
- With state on, finished reports are kept in a checkpoint next to the state file. A retry of the same head and diff reuses them; `/jig-review-cycle` messages a failed runner to go on, or starts one with `retry: reuse the checkpoint`, instead of a second full fan-out.
