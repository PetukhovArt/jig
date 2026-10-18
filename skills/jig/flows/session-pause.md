---
name: session-pause
description: "stop cleanly with a resume point."
---
# session-pause

**You own a clean stop. Leave a checkpoint a cold-start agent can resume from.**

Atoms: autonomy.

1. Reach a safe boundary: finish or revert the change in flight; stop subagents you started.
2. Do nothing irreversible on the way out.
3. Commit work in progress as `wip: <what>` on the current branch.
4. Write the resume note into the dashboard: `dash decision "pause" --why "<where you are>"` and `dash result "resume" "<first action on resume>"`.

Reply: where you are in the flow, what is on disk versus only in your head (paths, no diff dumps), the commits you made and whether the tree is clean, the first action on resume. This is a pause, not a final report.
