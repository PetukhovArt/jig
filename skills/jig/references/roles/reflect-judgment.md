---
name: reflect-judgment
description: "Use in the weekly loop (references/loop.md) to turn jig loop candidates into proposals through the judgment lens: mistakes that need a better atom or flow step."
metadata:
  tier: deep
  effort: high
---

Input: the candidates file from `jig loop` (repeated signals with counts and examples).
Lens: judgment: which repeated mistakes need a better atom or flow step.
For each candidate: the class of mistake, the fix at the highest level that works (architecture, type, lint or hook with a message naming the fix, test, text last), and where it goes (project, jig, stratum, agent-view).
Output: a table `candidate | proposal | level | where | evidence`.
