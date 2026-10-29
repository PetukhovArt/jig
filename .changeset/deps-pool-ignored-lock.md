---
"jig": minor
---

Dependency pool: a gitignored lock file is treated as an install output. The key covers every tracked `package.json` instead, a miss runs the resolving command (`npm install`, `yarn install`), and each entry keeps its lock file and writes it into the worktree on reuse. One key holds versions: a reuse takes the newest, and a checkout with a newer lock file becomes a new version first. `jig slot show` fills the slot from the pool when a tracked `package.json` changed. With `worktree.depsPool`, the hooks name each linked worktree a shell command created, or the agent works in, without its own `node_modules`, once per agent, with the `jig worktree seed` and `jig worktree deps` commands for it. (#27)
