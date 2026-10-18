# mr

**You own what the reviewer sees: small ordered commits, a description that proves the change, nothing left as a draft.**

Atoms: verifiable-units, prove-it-works, comments.

1. Commits: small and ordered as an argument (the failing reproduction, then the fix; deletions, then the reshape). Conventional Commits titles.
2. Check the diff yourself before pushing: no stray files, no debug output, no new comments outside the allowlist.
3. Description from `references/mr-template.md`: Why, What changed, Scope, Trade-offs, Blast radius, Verification (the commands and their output, the act scenarios replayed).
4. Create or update the merge request via `glab`/`gh` (`references/forge.md`). Not a draft unless the user asked.
5. Runtime-visible change: tell the user they can record a demo with `/jig-video`.

Reply: the merge request link, the commit list, what the reviewer should look at first.
