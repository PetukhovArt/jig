---
name: mr
description: "the shared last step of every code-changing flow: review your own diff, prove the UI, pass jig pre-mr, open a merge request that proves the change."
---
# mr

**You own what the reviewer sees: a reviewed diff, proven behavior, small ordered commits, nothing left as a draft.**

Atoms: small-steps, prove-shippable, comments.

1. Review your own diff: the `jig-review` skill in mode `pre-mr`. Fix every Act on item. Consider items go to the user in your reply. Noted and Dismissed stay in the review output. No second review after the fixes.
2. Clean up the diff: no stray files, no debug output or tagged debug logs, no new comments outside the allowlist (atom comments).
3. Merge request wanted? Yes when the user asked for a merge request or the repo has a remote (`git remote` prints a name). No: `skip: no merge request asked and no remote` for steps 4 to 10; stop here with the changes left uncommitted.
4. Branch before the first commit: on the default branch or a detached HEAD, `git switch -c <type>/<slug>` first.
5. UI touched (the branch changes files the user sees: by the project's UI file patterns and your judgment)? Not touched: `skip: UI not touched`. agent-view not configured (SKILL.md): `skip: agent-view not configured`, `jig pre-mr` asks for no UI proof. Configured: the proof is optional: hitl, ask the user whether to run it, with your recommendation; afk, run it. Declined: `jig skip-verify` (step 6) with the user's reason. To run it: show the branch in a slot (`jig slot show <n> <branch>`), never in the copy where an agent writes code; the slot shows commits only, so commit first. There, after your last UI edit, on the runtime `agent-view.config.json` names: replay every use case of the feature and screenshot its key screens, each through `jig pre-mr proof "agent-view act replay <use case>"` and `jig pre-mr proof "agent-view screenshot"` (jig runs the command and records it only when it exits 0); then `flows/bug-bash.md` in final-step mode on your own diff, fix what it finds, and record it: `jig pre-mr bug-bash "<bugs found and fixed, what could not be tested>"`.
6. Run `jig pre-mr [<target branch>]`, with `-- <the task's paths>` when the working tree holds uncommitted work that is not the task's (as for the review). Exit 0: continue; its `Bug-bash:` and `Verification level:` lines go into the description. Exit 1: it lists what is missing; do it and rerun. The proof cannot run here (no runnable app): `jig skip-verify --level unit-test|type-check|none --why "<reason>"`, with the highest level you actually reached.
7. Commits: small and ordered as an argument (the failing reproduction, then the fix; deletions, then the reshape). Conventional Commits titles.
8. Description from `references/mr-template.md`: Why, What changed, Scope, Trade-offs, Change impact, Verification (the commands and their output, the use cases replayed with their screenshots, the bug-bash result, the verification level).
9. Create or update the merge request via `glab`/`gh` (`references/forge.md`). No remote: `skip: no remote`, the reply carries the branch and its commits. Not a draft unless the user asked.
10. Runtime-visible feature or fix: suggest the user record a demo with `/jig-video`.

Reply: the merge request link (or the branch), the commit list, the review verdict counts (Act on fixed, Consider for the user), the verification level, what the reviewer should look at first. Steps 4 to 10 skipped: the review verdict counts and the uncommitted files.
