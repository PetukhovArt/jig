---
name: jig-slots
description: "Give a task its own git worktree slot with offset dev-server and CDP ports, so it can run next to other work. Use when work must run in parallel with other agents or app instances, or a flow asks for a slot."
---

# jig slots

CLI: `node ${CLAUDE_PLUGIN_ROOT}/bin/jig.mjs slot <new|ls|rm|sweep>`. Slot settings live in the `slots` section of `.jig/config.jsonc`; a human edits it.

Pick the case and read only its reference:
- One worktree, no running app (tests, refactoring, analysis): `references/no-app.md`.
- Several agents in parallel, no running app: `references/parallel-no-app.md`.
- Two or three slots with running app instances: `references/app-slots.md`.
- A background agent prepares a slot for you: `references/background.md`.
- The agent's own built-in worktrees used as slots: `references/native-worktrees.md`.

Rules for every case:
- One writer per worktree. Never run two agents in one checkout.
- `slot new` prints the path, the slot number and the ports. Work only inside that path.
- Verify against the instance of your slot (its CDP port), not a neighbour's.
- Tear down what you started: `slot rm <n>` stops nothing for you; stop your processes by their ports first.
- `slot sweep` sorts worktrees into buckets. A bucket is advice, not permission to delete.
