# Weekly improvement loop

Turns a week of repeated signals from the journal into proposals. The human approves; you apply nothing without that approval.

1. Run `node <root>/bin/jig.mjs loop` (`--days <n>` for another window than 7 days). It aggregates `.jig/journal/*.jsonl` and prints the path of `.jig/runs/_loop/<YYYY-MM-DD>/candidates.md`.
2. Read the candidates file: a table of signal, rule, count and examples with `file:line` and time. No candidates: say so and stop.
3. Spawn three subagents in parallel, with roles `reflect-judgment`, `reflect-tooling` and `reflect-divergent`. Each gets its full role template plus the candidates file path.
4. Spawn one subagent with role `reflect-synthesizer` on the three tables.
5. Check the synthesizer's result against the candidates: every accepted proposal cites a candidate, and its fix sits at the highest level that works (structure, type, check, atom, flow step, issue in a tool).
6. Present the result and wait for the human's decision on each accepted item.

Reply:

**Accepted**

| Problem | Proposal | Where |
| --- | --- | --- |

**Rejected**

| Proposal | Failed filter |
| --- | --- |

**Backlog**

| Pattern | Where seen | Proposed mechanism |
| --- | --- | --- |

Then the candidates file path. Nothing is applied until the human approves it.
