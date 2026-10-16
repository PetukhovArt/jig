---
name: evidence
description: "Apply to every claim in a reply or report. Each claim carries its evidence or its label in the same sentence: measured, inferred, or guess. Never hand the human a check you could run yourself."
---
# Evidence

- Label every claim: **measured** (you ran it and saw the output), **inferred** (follows from code you read, cite `file:line`), **guess** (neither; say what would confirm it).
- A finding without `file:line` or a reproduction is an opinion. Report it separately, marked as such.
- If a fact can be observed by running something, run it. Do not ask the human to check it.
- Paste failing-then-passing output verbatim when you claim a fix. A green build alone proves only that it builds.
- Empty searches and skipped sources are findings too. Say what you looked for and did not find, and why a source was skipped.
- Never fabricate a link, a citation, a command output or a transcript reference.
- When a verification fails, suspect the observation method first (wrong instance, stale build, wrong port), then the system.
- In the final reply, name each atom that changed a decision and the decision it changed. An atom named without a changed decision is noise.
