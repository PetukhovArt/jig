---
name: shared-state
description: "Apply when concurrent actors, modules or runs might write the same file, key, branch or state object, or when a command must survive crashes and retries. Eliminate the sharing first; make every step converge to the same end state on rerun."
metadata:
  group: Design
---
# Shared state

- Give each actor its own file, key, branch or worktree before reaching for a lock.
- A lock is a reason to revisit the design, not a ready answer: first ask why two actors write the same thing.
- State has one owner. Others read and write it only through the owner's API.
- Modules that talk through globals, singletons or untyped events have a contract only by convention: make it explicit.
- An API that is correct only in a certain call order (init before use) enforces that order or removes it.
- Derive each step from the state that exists, not from what the last run meant to do.
- Anything a run leaves behind must be recognizable as stale by the next run, wherever the last one stopped.
- Test: run it twice, crash it anywhere, rerun. It must converge.
