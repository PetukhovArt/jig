---
"jig": minor
---

Cheaper reviews of small diffs.

- `jig-review` on a diff with `N = 1` reviews inline in the session: no finder subagent, and one judge on another model only when an Important candidate survives. Without a selector such a diff runs `quick`; `--selector full` runs every angle.
- `jig review-plan` takes `--mode review|pre-mr`, `--mr` and `--no-state`, prints the absolute paths of each reader's angle files and atoms, and ends with the step files that apply to the run.
- State files are kept only in mode `review` with a merge request; mode `pre-mr` and a review of a bare branch write nothing under `.jig/runs/review/`.
- Judges read the gate files of their cluster's classes (`skills/jig-review/gates/`) instead of the whole verify step.
