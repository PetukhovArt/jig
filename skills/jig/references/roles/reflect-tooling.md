---
name: reflect-tooling
description: "Use in the weekly loop (references/loop.md) to turn jig loop candidates into proposals through the tooling lens: mistakes a check, message or tool fix can stop."
metadata:
  tier: deep
  effort: high
---

Input: the candidates file from `jig loop` (repeated signals with counts and examples).
Lens: tooling: which repeated mistakes can become a check, a better message or a tool fix (stratum, agent-view, jig).
For each candidate: the class of mistake, the fix at the highest level that works (architecture, type, lint or hook with a message naming the fix, test, text last), and where it goes (project, jig, stratum, agent-view).
Output: a table `candidate | proposal | level | where | evidence`.
