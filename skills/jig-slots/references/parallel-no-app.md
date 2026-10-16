# Several agents in parallel, no running app

Each agent gets its own worktree: one writer per worktree, never two agents in one checkout. Without a running app the ports do not matter, but the slot number still names the worktree, so the numbering rules below hold.

## Slot math

`jig slot new [--slug <s>] [--branch <b>]` creates the slot. For slot **N** (integer ≥ 1):
- each port key → `base + N * step`
- CDP port → `cdp.base + N * cdp.step`

The slot is encoded in the worktree directory name (`<repo>-s<N>-<slug>`), with no separate registry. `<slug>` is a short kebab feature label (from the branch name, or asked from the user) so the dir reads as its task at a glance; the `s<N>` token stays the source of truth.

`slot new` runs `git worktree prune`, then takes the smallest N ≥ 1 with no dir matching `<repo>-s<N>(-…|$)` in `git worktree list`. The token must end at `-` or end-of-name, so `s1` does not match `s10`.

**A slot number must be unique across live worktrees.** Two dirs carrying the same `s<N>` share every port and CDP: whichever starts second dies on `EADDRINUSE`, or worse, verify attaches to the neighbour's app and reports success. `slot new` scans the whole `git worktree list` and exits with code 1 and the list of duplicates. Rename or remove one of them before provisioning anything new.

**Prune is not optional.** A worktree whose dir was deleted by hand stays in `git worktree list` as `prunable`: its slot then reads as occupied forever and the count drifts upward with every manual cleanup. If an entry is still listed as `prunable` after `git worktree prune`, report it rather than reusing its N.

## Guardrails

- One worktree = one slot = one task. Don't reuse a slot dir for a different branch; remove it and create a new one.
- **The branch does not carry the slot number**: `feat/x`, not `s3/x`. Branches go to the remote and into merge requests; N is machine-local and reused, so a removed and re-created slot would leave the branch name lying. The slot stays visible in the dir name and in `agent-view.config.json`.
- **Remove a slot only with `jig slot rm`.** Deleting its dir or its row in another tool frees N while the slot's ports stay held by its detached processes.
- `slot new` prints the path, the slot number and the ports. Each agent works only inside its own path.
- `jig slot ls` shows the live slots, their ports and branches.
- When an agent is done: `jig slot rm <N>` (it refuses while the worktree has tracked changes, unless `--force`). The branch stays; delete it only if the user asks.
