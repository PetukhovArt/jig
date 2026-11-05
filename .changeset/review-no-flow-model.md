---
"jig": minor
---
`jig-review` no longer builds a flow model: no `flow-modeler` subagent, no flow index, no `model:` line in the output or the review runner's return. No eval showed that it found more, it cost $2.4–3.3 and 110–137k tokens per review, and the finders re-read the same code anyway. A finder follows a link out of its partition (an import, a store key, an event, IPC, a request) in the code itself and names it with the other side's `file:line` in `cross:`; the judge reads both sides. The cost estimate prices the finders only, `jig review cost` has no `modeler` role, and a `tiers.flow` key in `.jig/review.jsonc` is accepted and ignored.
