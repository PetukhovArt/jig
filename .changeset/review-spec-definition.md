---
"jig": minor
---

One definition of the spec of a task, for `jig-review`, the process adapter's `spec` op and `jig review-cycle spec`: the task's own text in its tracker (with subtasks and comments), or a spec or PRD document the task or the merge request links. A project document that only describes the touched area is context, never the spec, so angle 15 and the spec hold no longer judge a diff against it.

- A task the merge request names (an issue reference or a tracker key in its title, description, branch or commits) is always read; `discover.tracker` is gone from `.jig/review.jsonc`, `discover.spec: false` still turns the search off.
- A spec read from a tracker is kept in a file next to the state file; the `spec` tail of the output and the review runner's new `spec:` line name it, and the review cycle runs its spec hold against that file.
