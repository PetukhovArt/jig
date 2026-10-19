---
"jig": minor
---

Explicit config, gates before the edit, UI proof before the merge request.

Breaking:

- No tool runs until `.jig/config.jsonc` names it (`"eslint": {}`, `"tsc": { "command": "vue-tsc" }`, `false` to turn one off). `rules` no longer takes `gate/*` levels. Run `/jig-init` or `jig init` to get the proposal; `.jig/config.local.jsonc`, outside git, is laid over the shared config.
- Removed the pre-bash, post-read and post-bash hooks, protected paths, `jig allow-no-verify` and the rules `jig/protected-paths`, `jig/no-verify`, `jig/suppressions` and `jig/verify-fact`. Guard config files with the permissions deny block that `jig doctor` prints; drop the removed rules from your config.
- New comments and new test cases are denied at pre-edit, once with their atom; a retry of the same call passes. The comment gate is on by default; turn it off with `"jig/comments": "off"` and the test gate with `"jig/tests": "off"`. Suppression directives are always denied.
- The end of a turn no longer asks for UI proof. `jig pre-mr` gates the merge request instead: `jig pre-mr proof "<command>"`, `jig pre-mr bug-bash "<result>"`, or `jig skip-verify --level unit-test|type-check|none --why "<reason>"`.
- `jig dash` is replaced by the user-invoked skill `jig-task-status` and `jig task-status log|open|path`.
- `jig slot sweep` is replaced by `jig worktree sweep`, which removes a worktree only when you confirm it.
- The `review` flow is replaced by the `jig-review` skill (modes `review` and `pre-mr`).
- Atoms are no longer delivered after an edit by `paths`; `/jig` reads them from the atom index in `skills/jig/SKILL.md`. `skills/jig/references/atoms.md` is gone.

Added:

- `jig init [--update]` and the `jig-init` skill; own checks in `checks[]`.
- `jig slot show <N> <branch>`, `jig worktree seed <dir>` and `jig worktree sweep`.
- `jig review-plan` and the `jig-review` skill.
- Flows `custom-flow`, `metric-climb`, `diagnose` and `eval`.
- Skills `jig-grill` and `jig-prune-comments`.
