---
"jig": minor
---

`jig ui prove` drives every combination of `jig ui matrix` in the running app through agent-view (emulate, theme and locale switch, state replay, layout and scene audit, screenshot), compares the result with a Figma frame or an image as evidence, writes the evidence page `.jig/ui/<branch>/index.html` and records the `ui-matrix` proof when no audit error stands.
