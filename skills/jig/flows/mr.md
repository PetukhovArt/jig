---
name: mr
description: "the shared last step of every code-changing flow: review your own diff, prove the UI, pass jig pre-mr, open a merge request that proves the change."
---
# mr

**You own what the reviewer sees: a reviewed diff, proven behavior, small ordered commits, nothing left as a draft.**

Atoms: small-steps, prove-shippable, comments.

1. Review your own diff: the `jig-review` skill in mode `pre-mr`. Fix every Act on item. Consider items go to the user in your reply. Noted and Dismissed stay in the review output. No second review after the fixes.
2. Clean up the diff: no stray files, no debug output or tagged debug logs, no new comments outside the allowlist (atom comments).
3. UI touched (the branch changes files the user sees: by the project's UI file patterns and your judgment)? Show the branch in a slot (`jig slot show <n> <branch>`), never in the copy where an agent writes code. There: `agent-view act replay` every use case of the feature and screenshot its key screens; then `flows/bug-bash.md` in final-step mode on your own diff and fix what it finds. Not touched: `skip: UI not touched`.
4. Run `jig pre-mr`. Exit 0: continue. Exit 1: it lists what is missing; do it and rerun. The proof cannot run here (no runnable app, no agent-view): `jig skip-verify --level unit-test|type-check|none --why "<reason>"`, with the highest level you actually reached.
5. Commits: small and ordered as an argument (the failing reproduction, then the fix; deletions, then the reshape). Conventional Commits titles.
6. Description from `references/mr-template.md`: Why, What changed, Scope, Trade-offs, Change impact, Verification (the commands and their output, the use cases replayed with their screenshots, the bug-bash result, the verification level).
7. Create or update the merge request via `glab`/`gh` (`references/forge.md`). Not a draft unless the user asked.
8. Runtime-visible feature or fix: suggest the user record a demo with `/jig-video`.

Reply: the merge request link, the commit list, the review verdict counts (Act on fixed, Consider for the user), the verification level, what the reviewer should look at first.
