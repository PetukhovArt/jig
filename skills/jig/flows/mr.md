---
name: mr
description: "the shared last step of every code-changing flow: review your own diff, prove the UI, pass jig pre-mr, open a merge request that proves the change."
---
# mr

**You own what the reviewer sees: a reviewed diff, proven behavior, small ordered commits, nothing left as a draft.**

Atoms: small-steps, prove-shippable, comments.

1. Review your own diff: the `jig-review` skill in mode `pre-mr`. Fix every Act on item. Consider items go to the user in your reply. Noted and Dismissed stay in the review output. No second review after the fixes.
2. Clean up the diff: no stray files, no debug output or tagged debug logs, no new comments outside the allowlist (atom comments).
3. UI touched (the branch changes files the user sees: by the project's UI file patterns and your judgment)? No UI proof tool in `.jig/config.jsonc` (no `agent-view`): `skip: no UI proof tool`, `jig pre-mr` asks for none. Otherwise the proof is optional: hitl, ask the user whether to run it, with your recommendation; afk, run it. Declined: `jig skip-verify` (step 4) with the user's reason. To run it: show the branch in a slot (`jig slot show <n> <branch>`), never in the copy where an agent writes code; the slot shows commits only, so commit first. There, after your last UI edit: replay every use case of the feature and screenshot its key screens, each through `jig pre-mr proof "agent-view act replay <use case>"` and `jig pre-mr proof "agent-view screenshot"` (jig runs the command and records it only when it exits 0); then `flows/bug-bash.md` in final-step mode on your own diff, fix what it finds, and record it: `jig pre-mr bug-bash "<bugs found and fixed, what could not be tested>"`. Not touched: `skip: UI not touched`.
4. Run `jig pre-mr [<target branch>]`. Exit 0: continue; its `Bug-bash:` and `Verification level:` lines go into the description. Exit 1: it lists what is missing; do it and rerun. The proof cannot run here (no runnable app, no agent-view): `jig skip-verify --level unit-test|type-check|none --why "<reason>"`, with the highest level you actually reached.
5. Commits: small and ordered as an argument (the failing reproduction, then the fix; deletions, then the reshape). Conventional Commits titles.
6. Description from `references/mr-template.md`: Why, What changed, Scope, Trade-offs, Change impact, Verification (the commands and their output, the use cases replayed with their screenshots, the bug-bash result, the verification level).
7. Create or update the merge request via `glab`/`gh` (`references/forge.md`). Not a draft unless the user asked.
8. Runtime-visible feature or fix: suggest the user record a demo with `/jig-video`.

Reply: the merge request link, the commit list, the review verdict counts (Act on fixed, Consider for the user), the verification level, what the reviewer should look at first.
