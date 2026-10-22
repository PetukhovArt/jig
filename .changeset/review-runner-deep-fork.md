---
"jig": minor
---

The review runner runs on the deep tier at medium effort, and its finders run on the same model, so they still fork from it.

- On the standard tier the runner skipped steps and read step files its plan did not list. The `lean` and re-review finders move to the deep tier with it: a fork needs the spawner's model, and a fork inherits its effort.
- `/jig-review-cycle` reads the engine files of a re-review once per pass and forks a runner per re-review with a `prepared:` line; a first run, or a fork that returns `needs fan-out`, gets a fresh runner.
- A re-review skips the full-diff `jig review-plan` in step 01 and plans on its new range in step 09: the full-diff plan listed finder and verify steps the run never took.
