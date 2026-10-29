---
"jig": minor
---

Dependency pool: `jig worktree deps <dir>`, and `jig slot new` / `jig slot show` with `worktree.depsPool` in `.jig/config.jsonc`, install `node_modules` (npm, yarn) once per root lock file and give every later worktree with the same lock file a hardlink copy of it from `.git/jig/deps`, instead of a full install per worktree. `worktree.depsPool.after` reruns what the install also builds outside `node_modules`. (#27)
