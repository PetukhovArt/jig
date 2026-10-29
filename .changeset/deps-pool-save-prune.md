---
"jig": minor
---

Dependency pool: the key covers `package.json` along with the lock file, so a branch with the main checkout's copied lock file no longer gets the main checkout's entry. `jig worktree deps` takes the main checkout too; on a miss it pools a fresh install of another checkout with the same key instead of installing; `--save` makes a checkout's current `node_modules` the entry without an install; `--prune [--dry-run]` removes the entries no checkout uses. (#27)
