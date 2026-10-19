---
name: jig-slots
description: "Give a task its own git worktree, and show finished branches in a slot: a worktree with a warm dev server on offset dev and CDP ports. Use when work must run in parallel with other agents or app instances, or a flow asks for a worktree or a slot."
---

# jig slots

CLI: `node ${CLAUDE_PLUGIN_ROOT}/bin/jig.mjs slot <new|show|ls|rm>` and `... worktree <seed|sweep|remove>`. Slot settings live in the `slots` section of `.jig/config.jsonc`, seed settings in its `worktree` section; a human edits both.

Terms:
- **worktree**: a separate tree where an agent edits the code of one feature. No dev server runs in it.
- **slot**: a worktree with packages installed and the dev server always running, numbered 1 to 3. A slot shows a branch: `slot show <n> <branch>` checks the branch out detached (one hot reload) and installs when a lock file changed. New edits reach it by another `show`.

Pick the case and read only its reference:
- One worktree, no running app (tests, refactoring, analysis): `references/no-app.md`.
- Several agents in parallel, no running app: `references/parallel-no-app.md`.
- Slots with running app instances: `references/app-slots.md`.
- A background agent prepares a slot for you: `references/background.md`.
- The agent's own built-in worktrees: `references/native-worktrees.md`.

Rules for every case:
- One writer per worktree. Never run two agents in one checkout.
- Never run dev in the copy where an agent writes. Edits go to a worktree; the app runs in a slot and gets them with `slot show`.
- A fresh worktree has only tracked files: `worktree seed <dir>` copies the ignored files and links from the main checkout. `slot new` seeds by itself.
- `slot new` prints the path, the slot number and the ports. Work only inside that path.
- Verify against the instance of your slot (its CDP port), not a neighbour's.
- Tear down what you started: `slot rm <n>` stops nothing for you; stop your processes by their ports first.
- `worktree sweep` sorts worktrees into buckets and deletes nothing. A bucket is advice: delete an item only after the user agrees to that item, with `worktree sweep --yes <path|slot>`.
