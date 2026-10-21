---
"jig": minor
---

`jig review-plan` reviews only the given paths: `review-plan [<base>] -- <pathspec>...`.

- The paths scope `LINES`, the finder count, the layout, the diff shape and the untracked count; the `lines:` line names the scope.
- A new `diff:` line prints the command for the reviewed diff, paths included; finders, judges and the inline path read the diff through it.
- `jig-review` in mode `pre-mr` passes the task's paths when the working tree holds uncommitted work that is not the task's.
