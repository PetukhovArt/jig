# Project config

Optional: `.jig/review.jsonc` in the repository, committed or local. In a linked worktree the file the branch tracks wins; an untracked one is read from the main checkout (the first entry of `git worktree list`), never from a seeded copy in the worktree. No file: the defaults below. `jig review-plan` reads `angles`, `tiers`, `maxParallel`, `layout`, `testPaths` and `partitions` from it and rejects a malformed value with its path; `jig review rules` reads `discover.rules`, `.standards` and `.exclude`; the agent reads the rest.

Merge at the top level: a declared key replaces the default one whole; the others come from the default. Exceptions: `angles` and `tiers` merge per entry. The summary always says `config: .jig/review.jsonc`, `config: <main checkout>/.jig/review.jsonc` or `config: default`.

## Default: the skill's behavior written out

```jsonc
{
  "iterationsMemory": true,
  "discover": {
    "spec": true,
    "rules": ["AGENTS.md", "CLAUDE.md", "CLAUDE.local.md", "REVIEW.md"],
    "standards": ["**/{standards,conventions}/**/*.md"],
    "exclude": ["**/{tracker,packages,adr,adrs,doc}/**", "docs/*.md"]
  },
  "review": { "language": null },
  "severity": { "source": null },
  "route": {},
  "angles": {},
  "tiers": {},
  "maxParallel": 6,
  "layout": "auto",
  "testPaths": [],
  "partitions": null
}
```

## Fields

- **`iterationsMemory`**: a re-review reviews only the new diff and keeps the threads ([step 03](../steps/03-state.md)). `--no-state` wins over the config.
- **`discover.spec`**: whether to look for the task's spec ([prepare](../steps/01-prepare.md#spec): a task the merge request names is read in its tracker whenever this is on).
- **`discover.rules`**: index file names. Searched at any depth by walking up from the diff's directories; `@file` inside is expanded ([step 02](../steps/02-rules.md)).
- **`discover.standards` / `.exclude`**: globs of standard documents and what to drop from the found. The default drops the top-level pages of `docs/` (documentation, not rules) and keeps `docs/standards/**`. A standard an index links is scoped to that index's directory; an unlinked one covers the whole repository. Only the finders of project angles of kind `conventions` read them.
- **`review.language`**: the language of comment texts ([comment texts](../steps/07-comments.md)). `null`: the language of the merge request description and its threads.
- **`severity.source`**: the path of the file whose severity sections replace the skill's taxonomy whole ([severity source](../steps/02-rules.md#severity-source)). `null`: searched among the `discover.rules` indexes. Needed when the file is not on the walk-up path.
- **`route`**: `glob → angle numbers or project angle names`. A document goes into the personal tail of the finders that carry such an angle. Matched nothing: the default of [step 02](../steps/02-rules.md): indexes and standard bodies to every conventions finder whose partition they cover, as `jig review-plan` prints under `rules:`.
- **`angles.<n>`**: one of the skill's angles, 1–5, 8, 12, 14, 15, 16, 18 ([index](../angles/00-index.md)). `enabled: false` turns the angle off before any spawn; `severityCeiling` (`Important` or `Nit`) sets the ceiling of its findings ([severity](../gates/severity.md)). Every angle is on by default, with the ceiling `Important`; a ceiling of `Nit` takes the angle out of the `important` selector token. A number of a removed angle (6, 7, 9, 10, 11, 13, 17) is accepted and changes nothing, so an older config still loads.
- **`angles.<name>`**: an angle the project adds. The key is its name (lowercase letters, digits, dashes); `file` is the angle file, from the repository root; `kind` is `behavior` or `conventions`: the finders of that kind in every partition read the file under `read:` and hunt it over their code parts, with the atoms its `**Atoms:**` header names. A `conventions` finder runs only for such angles, on the standard tier, and reads the documents under its `rules:` line. `enabled` and `severityCeiling` work as for a numbered angle; without a ceiling it runs under `full`, `quick` and `auto`. A missing file fails `jig review-plan`. The file follows the shape of the skill's angle files ([index](../angles/00-index.md)): what to look for, what is not a finding, the evidence. Prefer a check that blocks the merge over a conventions angle when tooling can prove the rule.
- **`tiers`**: tier and effort per token or role over the defaults in the [selector](selector.md#tiers), the same shape: `{ "conventions": { "tier": "fast", "effort": "medium" } }`. A declared entry replaces one default entry; the others stay. Which models serve a tier is not a project matter: `~/.jig/config.jsonc`, key `tiers`, per agent (`jig tiers`).
- **`maxParallel`**: the cap on subagents running at once ([rules for the whole run](../SKILL.md#rules-for-the-whole-run)).
- **`layout`**: `auto` (default, = `lean`), `lean` or `solo` ([paths](../SKILL.md#paths)). `--layout` and the environment variable `JIG_REVIEW_LAYOUT` win over it.
- **`testPaths`**: globs of test files on top of the built-in ones (test file names of each language, `test/`, `tests/`, `__tests__/`, `_tests_/`, fixtures and snapshots). Test files go into the `pN-tests-*` diff parts of their partition, which its `test-reviewer` reads when [angle 16](../angles/16.tests.md) runs; with `angles.16.enabled: false` no finder reads them.
- **`partitions`**: a text that says how to split the diff's code files into partitions, one finder of each kind per partition. `null`: `jig review-plan` splits by lines (`N = ceil(LINES / 150)`, at most 5) along imports and directories. A text: `jig review-plan` computes no `N`; it prints the text, the changed code files with their counted lines and the imports between them, and the review runner groups the files by the text and runs the command again with one `--partition` per group ([prepare](../steps/01-prepare.md#layout)). Every finder gets the text in its brief. A re-review range under 600 lines stays one partition.

The skill has no caps on the number of threads: whatever survives verify reaches the author.

## Example

```jsonc
{
  "discover": {
    "rules": ["AGENTS.md", "CLAUDE.md"],
    "standards": ["docs/standards/code/*.md"],
    "exclude": ["docs/standards/{doc,packages,tracker}/**", "**/GLOSSARY*.md"]
  },
  "route": {
    "docs/standards/code/naming.md": ["naming"]
  },
  "angles": {
    "8": { "severityCeiling": "Nit" },
    "event-catalog": { "file": ".jig/angles/event-catalog.md", "kind": "behavior" },
    "naming": { "file": ".jig/angles/naming.md", "kind": "conventions" }
  },
  "partitions": "One finder per feature module (src/features/<x>, src/domain/<y>) whatever its size; split a module only when it has unrelated parts; glue a group under ~50 lines to its closest neighbour."
}
```

The walk up finds `src/payments/AGENTS.md`, a long adapter contract that a search by name never sees. `exclude` drops large glossaries. `angles.8` lowers the ceiling: the project does not hold a leak or a hot path as a merge blocker, so [angle 8](../angles/8.efficiency.md) stays at `Nit` and `quick` leaves it out. `event-catalog` is the project's own angle for the behavior finders. `naming` checks the names the user sees against the project's naming standard: tooling cannot prove it, so it runs as a conventions angle, and `route` sends it only that standard. `partitions` gives a cohesive module one finder: split by lines, a 1,161-line module went to five finders that duplicated each other's work.

## Boundaries

The config says **where** to look and **where** to route. It does not decide whether a file describes how to write code, and it does not copy rules: the bodies live in their files, the config points at them.
