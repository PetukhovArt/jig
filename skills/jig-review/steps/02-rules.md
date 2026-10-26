# Project rules

What to look for comes from `discover` in the [project config](../references/project-config.md). Below is how to look.

## 1. Indexes, walking up from the diff

A rules document is **searched for, not assumed**: a repository need not call it `REVIEW.md`, and the main rules often sit next to the code, not at the root.

Take the directories the diff touches and walk from each up to the root, collecting files named in `discover.rules`:

```
node "<root>/bin/jig.mjs" review rules <base> [-- <path>...]
```

It prints `index <path>` for each rules index on the walk up from every changed file's directory to the repository root, root included, by the names of `discover.rules` (default `AGENTS.md`, `CLAUDE.md`, `CLAUDE.local.md`, `REVIEW.md`); `standard <path>` for the standard documents of step 2; `architecture <path>` for the documents [angle 13](../angles/13.architecture.md) section B may need. It reads `discover` from `.jig/review.jsonc` itself.

**A file's scope is its directory.** A rule from `src/payments/AGENTS.md` applies only to files under `src/payments/`. A finding by it outside that directory is invalid.

**`@file` inside is an import, not text.** A line `@AGENTS.md` means "read that file"; expand recursively. Otherwise the content is one useless line.

## 2. Standard documents

Only when the [selector](../references/selector.md) runs angle 6, 10 or 13: only the rules finder reads standard bodies.

The `standard` lines of `review rules`: Markdown files named like a review document, a convention, a standard, a code style or a guideline, plus the globs of `discover.standards`, minus the globs of `discover.exclude`; `$REVIEW_RULES` (a path or glob) replaces both when set. The default drops commit formats, ADRs and versioning: they are about operating the repository, not about judging code.

## 3. Filter

Collect **everything** found, not "first wins": the index at the root and the rule next to the code are both needed.

Drop what is not a rule: meeting notes, release checklists, documents about the *review process*, changelogs, directory overviews, build and test commands, tooling setup, commit and merge request workflow. Those are instructions for building, not criteria for judging; a finder fed with them starts flagging "did not run the linter".

**What is read as input, and nothing else:** the rules indexes of step 1 (`AGENTS.md`, `CLAUDE.md` and the other `discover.rules` names closest to the changed files), the task's spec or PRD ([prepare](01-prepare.md#spec)), and the standard bodies of step 2. A README, a directory overview, an ADR index or a glossary map is not read whole; a document an index links is opened only when a candidate needs the rule it holds.

**The filter applies to the input, not the target.** Glossary and ADRs do not go into the shared block: only the rules finder searches them, for [angle 13](../angles/13.architecture.md) sections C and D, by grep and by path, never whole. When the diff **changes** them, their hunks are in the `docs-*` parts and the change is reviewed like code: [angle 11](../angles/11.docs.md), question 2.

**Priority in a conflict:** the document closest to the code beats the farther one; `REVIEW.md` beats `AGENTS.md` at the same level.

## Severity source

The severity taxonomy comes from one file ([verify](../gates/severity.md)):

1. `severity.source` from the project config: a path in the repository;
2. otherwise the index from step 1 closest to the code that has a severity section, `REVIEW.md` before `AGENTS.md` at the same level;
3. neither: the skill's default.

`severity.source` points to a missing file: stop with an error. Silently falling back to the default reviews by someone else's bar.

**Verbatim, never retold.** The severity sections go into the shared block and into every judge brief as they are. A retelling turns examples into a closed list: a project line `I2 wrong behavior visible to user (binding…; reactivity…; crash…)` retold as a list did not cover erased input, and the judge gave `Nit`. When over the size limit, cut other sections, never these.

## 4. Routing

The `route` map of the config says which document goes to which angle. A document goes into the **personal tail** of the brief of every finder that has at least one of those angles ([step 04](04-finders.md)).

A document no glob matched goes by default: indexes from `discover.rules` into the **shared block** of every agent; standard bodies from `discover.standards` to the rules finder (angles 6, 10, 13). Other finders do not see the bodies: they do not need them, and the length multiplies by the number of agents.

The shared block overrides the skill's defaults: the severity taxonomy as a whole ([source](#severity-source)), skip rules and other defaults by their own text.

**The size limit is per angle's share, after routing.** A share over ~400 lines keeps the documents closest to the code.

**Architecture document, ADRs and glossary** for sections B, C and D of [angle 13](../angles/13.architecture.md) are a special case: the search is described in the angle itself, the only recipient is the rules finder.

**Name the result in the summary, always:**

```
config: .jig/review.jsonc
severity: docs/REVIEW.md          (or: skill default)
rules:  AGENTS.md (40) · docs/standards/code/*.md (124) → angle 10
        src/payments/AGENTS.md (111) → angles 1, 8, 12, 13
adr:    read 3 of 40 · glossary: src/billing/GLOSSARY.md
dropped: docs/standards/tracker.md, 5 GLOSSARY.md
```

or `rules: not found: angle 10 by the base smell vocabulary only, section 13B off`.
