---
name: deepening
description: "find module deepenings in a scope (paths, a merge request, a branch, a scan card), show them as an HTML report, then design and refactor the one the user picks."
---
# deepening

**You own the candidates. The user picks one. Design and refactoring do the rest.**

Atoms: module-depth, domain-model, reader-cost, smells, docs, context-window, questions.

1. Scope: the one the user named. Paths: the modules under them. A merge request or a branch: the files its diff against the base adds or changes, plus the modules that import them. A card of this flow's report or of an architecture scan (`<report path>#<card id>`): the card is the chosen candidate; check its `file:line` evidence, read the glossary and ADRs for its files, then go to step 6. No scope named: the current branch against its base; an empty diff there is a question to the user.
2. Ground: read the project's glossary (`GLOSSARY.md`, `*/glossary/*`) and the ADRs (`*/adr/*`) for the scope. If `stratum.config.jsonc` exists, read its layers and rules: they are constraints. An unfamiliar scope: the How mode of `flows/investigation.md` over it first.
3. Scan: role `deepener` in mode `scan`, the brief naming the scope, the grounding and atom `module-depth`. A scope too large for one context (atom context-window): one `deepener` per part (a directory or a group of files that import each other), up to four in parallel; you merge their candidates and drop duplicates. Spot-check each candidate's `file:line` claims and its deletion test before you keep it.
4. Report: write the candidates as one HTML file in the OS temp dir, per `references/deepening-report.md`, open it for the user and give its absolute path. A candidate that contradicts an ADR stays only when the friction is real enough to reopen the ADR, marked as such on its card.
5. Pick: ask the user which candidate to take (atom questions), with your top recommendation. Propose no interface before the pick. afk: take the top recommendation.
6. Grill the chosen candidate as `skills/jig-grill/SKILL.md` does: constraints, dependencies, what sits behind the seam, which tests survive. As decisions settle: a deepened module named after a concept not in the glossary adds the term (create `GLOSSARY.md` when none exists); a sharpened term is updated in place. The user rejects the candidate with a reason a future scan needs: offer an ADR so the scan does not propose it again; a passing reason ("not now") gets none.
7. Design: `flows/module-design.md` with the grilling as its grounding.
8. Implement: `flows/refactoring.md` against the chosen shape; it ends with `flows/mr.md`.

Reply: the scope, the report path, the candidates in one line each with their strength, the one the user picked and why, the settled and open decisions of the grilling, the glossary and ADR edits, then the replies of `module-design` and `refactoring`. Stopped after the report: the candidate you recommend and its resume command from the card.
