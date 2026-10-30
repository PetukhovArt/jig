---
"jig": minor
---
`jig-review` starts every review with a flow model: one `flow-modeler` subagent reads the whole diff once and writes the states, the transitions with their handlers, the cross-module links and the spec's rules to a file that every finder and judge reads and the output names. Finders split the diff's files instead of the angles: `jig review-plan` partitions the files by imports and shared directories into N groups, gives each finder one partition with every selected angle and only that partition's diff parts, and prints a one-line cost estimate.
