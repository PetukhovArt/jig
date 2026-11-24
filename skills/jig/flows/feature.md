---
name: feature
description: "build new behavior with the right data shape and prove it on the running product."
---
# feature

**You own the design. Delegate the code, review its diff, verify.**

Atoms: design-it-twice, domain-model, patterns, system-edges, do-less, effects, small-steps, shared-state, change-impact, prove-shippable, typescript, ux (UI touched).

1. Understand the area: the how step of `flows/investigation.md`. Find what already exists to reuse (atom one-way). Find the glossary nearest to the files the feature changes (atom domain-model): the names of new fields, props, types, events and labels come from it, not from the ticket text.
2. UI touched? Your judgment of what the user will see, not a list of file extensions. Record it always: `jig ui scope ui "<why>"` or `jig ui scope none "<why>"`. None: `skip: UI not touched` for step 3 and for the UI parts of steps 8 and 10. Ui, no app control (SKILL.md): `skip: no app control` for the same parts. Ui: the UI part of steps 4, 7 and 8 (reference, reuse, build, proof on every target, width and theme) is `flows/ui.md`; this flow keeps the data and the behavior.
3. Use case first (UI touched, app control available): find the feature's use case in the project's behavior catalog and replay it with the app control tool. Missing: describe it in the catalog, then record the click path to the feature's screen with the tool. The steps the feature adds are recorded once they work (step 8).
4. Design the interface: `flows/module-design.md`, with step 1 as its grounding. A fork you can settle by running something goes to `flows/prototype.md`.
5. Name the fact the change is safe because of (atom change-impact).
6. Throughput checkpoint: four todo items. One that does not apply keeps its item as `n/a: <reason>`.
   - Blocking first steps: what must exist before anything fans out.
   - Independent workstreams: disjoint files, modules or layers that can run in parallel.
   - Shared writes: what two workers would write; split it first (atom shared-state), serialize only for a real invariant.
   - Smallest safe decomposition: the fewest workers that cover it; one worker is fine when you can say why.
7. Delegate the code. Mandatory, no `skip`. Each delegate gets a brief: the files it owns, the data shape and its organizing structure, the names of the new fields and terms with the glossary path and line each comes from (no glossary: say so), the success check it must run, the atom paths it must read. Coupled code has one owner, in the current checkout; independent workstreams get one delegate each, in parallel, each in its own agent worktree. Review every delegate's diff yourself against the brief and the design; a fix round goes to a fresh delegate with the consolidated brief. A subagent that cannot spawn subagents writes the code itself and keeps the same review separation.
8. Verify on the surface the user uses, each unit before the next: the tests and checks that cover it. UI touched, app control available: drive the app on its runtime and extend the use case from step 3 to the feature's end state, then look at the feature with the worst-case data of atom `ux`, fed through the data boundary.
9. Update the feature's behavior catalog when the project keeps one.
10. Pre-MR stage: `flows/mr.md`. Always its review of your diff (`jig-review` in mode `pre-mr`) and cleanup. Only when the user asked for a merge request or the repo has a remote: the UI proof, `jig pre-mr`, commits on a branch and the merge request.

Reply: what you built, what you chose and why (a table for design alternatives), the throughput checkpoint, how you verified it, open decisions.
