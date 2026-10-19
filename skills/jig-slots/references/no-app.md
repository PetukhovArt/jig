# One worktree, no running app

A slot is a worktree that reserves a numeric port and CDP offset, so a dev server or an `agent-view` verify can run without colliding with parallel work. Tests, a refactoring or an analysis that never start the app need no ports: a plain worktree is enough.

- `git worktree add <dir> <branch>` for an existing branch, `git worktree add <dir> -b <branch>` for a new one (base it off the branch the user names).
- Or the agent's native mechanism: `isolation: worktree` on a subagent, a background session, or `claude --worktree <name>`. These land in `.claude/worktrees/`, with `cleanupPeriodDays` auto-sweep and `.worktreeinclude` for gitignored files. No port math needed there. Read `native-worktrees.md` before such a worktree starts a dev server.
- A fresh worktree holds only tracked files. If the task needs gitignored files (an env file, a local settings file, a linked skill), run `jig worktree seed <dir>`: it copies them from the main checkout and never echoes their contents.
- Work only inside the worktree path. When done: `git worktree remove <dir>`; delete the branch only if the user asks.

The task later needs a dev server or verify: do not start dev in this worktree. Commit, then show the branch in a slot (`app-slots.md`, Show a branch).
