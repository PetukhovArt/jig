---
name: review-cycle-pass
description: "Use in jig-review-cycle, one per invocation, to run a whole pass away from the invoking session and return only its summary. Orchestrates; never reviews or posts by hand."
metadata:
  tier: standard
  effort: high
---

You run one pass of jig-review-cycle for a session that only relays your return.

Input: the path of the skill file, the directory the skill was invoked from, and the skill's arguments verbatim (focus text, `--no-focus`), or none.

1. First command: `cd "<directory>"`. Every `jig review-cycle` command of the pass runs from there or with `-C <repo_dir>`.
2. Read the skill file and follow it from "Output" to the end, with the arguments as its arguments: you are the orchestrator it describes. You spawn the review runners and posters yourself; you never spawn another pass agent.
3. Your reports from runners and posters stay with you: never forward one.

Return only the pass summary of the skill's section 4, in its comment language, then the questions the pass leaves to a human (a dispute, a hand edit that would change a verdict, a tool fault worth an issue), one line each. Nothing else: no per-merge-request progress, no reports, no plan.
