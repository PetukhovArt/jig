---
"jig": minor
---

The review runner runs on the standard tier at high effort, so the standard finders it spawns fork from it.

- A fork inherits the spawner's model and effort; the runner was deep/medium, so every sonnet finder was spawned fresh and read every diff part itself. Now standard/high finders fork and start from the runner's prompt cache; judge, deepener and outcome check stay deep and fresh.
- When no finder forks, the orchestrator reads the diff index and only the ranges it judges, not every part.
- `/jig-review-cycle` spawns each role on its template's tier and effort, never the session's model.
