---
name: review
description: "review a merge request (yours or someone else's) and post proven findings."
---
# review

**You own the verdict, not the diff. Find aggressively, judge separately, prove every finding.**

Atoms: evidence, change-impact, do-less, reader-cost, domain-model, system-edges, one-way, dead-code, effects, smells, tests, comments, docs, typescript, lessons-to-checks.

1. Prepare: the merge request (yours or someone else's) via `glab`/`gh` (see `references/forge.md`), its description and linked task, the diff against its target, the project's rules (AGENTS.md, ADRs, glossary).
2. Find: spawn subagents with role `finder`, one per angle from `references/review-angles.md` that the diff touches. Each returns candidates only, with `file:line`.
3. Judge separately: one subagent with role `verifier` takes all candidates. It drops what a tool already checks, what is only style, what has no initiator, and what is not worth fixing; it confirms the rest by reproduction or by a trace "initiator → path → effect" with `file:line`.
4. For a client-server contract, look at both sides before judging.
5. Rank: important (data loss, crash, broken invariant, security, a claim of the change broken), nit, pre-existing (outside the diff).
6. Write each finding with the fix direction; prefer deletion or a narrower type over a new branch. A finding an existing abstraction already solves proposes migrating to it.
7. Post the threads only when the user asked to post; otherwise show them. Repeated findings across merge requests go to the journal note in the reply (atom lessons-to-checks).

Reply: a findings table (severity, `file:line`, what goes wrong, proof, fix), then what you dropped and why in one line each.
