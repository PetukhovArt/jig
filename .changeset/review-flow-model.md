---
"jig": minor
---
Finders split the diff's files instead of the angles: `jig review-plan` partitions the files by imports and shared directories into N groups, gives each finder one partition with every selected angle and only that partition's diff parts, and prints a one-line cost estimate of the finders. A finder follows a link out of its partition (an import, a store key, an event, IPC, a request) in the code itself and names it with the other side's `file:line` in `cross:`; the judge reads both sides. A `tiers.flow` key in `.jig/review.jsonc` is accepted and ignored.
