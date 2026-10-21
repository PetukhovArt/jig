# Project config

Optional: `.jig/review.jsonc` in the repository, committed. No file: the defaults below. `jig review-plan` reads `angles`, `tiers`, `maxParallel` and `layout` from it and rejects a malformed value with its path; the agent reads the rest.

Merge at the top level: a declared key replaces the default one whole; the others come from the default. Exceptions: `angles` and `tiers` merge per entry. The summary always says `config: .jig/review.jsonc` or `config: default`.

## Default: the skill's behavior written out

```jsonc
{
  "iterationsMemory": true,
  "discover": {
    "spec": true,
    "adr": true,
    "rules": ["AGENTS.md", "CLAUDE.md", "CLAUDE.local.md", "REVIEW.md"],
    "standards": ["**/{standards,conventions}/**/*.md"],
    "exclude": ["**/{tracker,packages,adr,doc,docs}/**"]
  },
  "review": { "glossary": true, "adr": true, "language": null },
  "severity": { "source": null },
  "route": {},
  "angles": {},
  "tiers": {},
  "maxParallel": 6,
  "layout": "auto"
}
```

## Fields

- **`iterationsMemory`**: a re-review reviews only the new diff and keeps the threads ([step 03](../steps/03-state.md)). `--no-state` wins over the config.
- **`discover.spec` / `.adr`**: whether to look for the task's spec ([prepare](../steps/01-prepare.md#spec): a task the merge request names is read in its tracker whenever this is on), ADRs as code rules ([angle 13](../angles/13.architecture.md), section C).
- **`discover.rules`**: index file names. Searched at any depth by walking up from the diff's directories; `@file` inside is expanded ([step 02](../steps/02-rules.md)).
- **`discover.standards` / `.exclude`**: globs of standard documents and what to drop from the found.
- **`review.glossary` / `.adr`**: whether a changed glossary or ADR is reviewed as a target ([angle 11](../angles/11.docs.md), question 2). Not `discover`: that is about input, this is about the target. A document can be skipped as rules and still have its change judged.
- **`review.language`**: the language of comment texts ([comment texts](../steps/07-comments.md)). `null`: the language of the merge request description and its threads.
- **`severity.source`**: the path of the file whose severity sections replace the skill's taxonomy whole ([severity source](../steps/02-rules.md#severity-source)). `null`: searched among the `discover.rules` indexes. Needed when the file is not on the walk-up path.
- **`route`**: `glob → angle numbers`. A document goes into the personal tail of the finders that have such an angle. Matched nothing: the default of [step 02](../steps/02-rules.md): indexes to everyone, standard bodies to the rules finder.
- **`angles.<n>`**: `enabled: false` turns the angle off before any spawn; `severityCeiling` (`Important` or `Nit`) sets the ceiling of its findings ([severity](../gates/severity.md)). A ceiling raised to `Important` puts the angle into the `important` selector token.
- **`tiers`**: tier and effort per token or role over the defaults in the [selector](selector.md#tiers), the same shape: `{ "tests": { "tier": "deep", "effort": "medium" } }`. A declared entry replaces one default entry; the others stay. Which models serve a tier is not a project matter: `~/.jig/config.jsonc`, key `tiers`, per agent (`jig tiers`).
- **`maxParallel`**: the cap on subagents running at once ([rules for the whole run](../SKILL.md#rules-for-the-whole-run)).
- **`layout`**: `auto` (default), `inline`, `fanout`, `lean` or `solo` ([paths](../SKILL.md#paths)). `--layout` and the environment variable `JIG_REVIEW_LAYOUT` win over it.

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
    "docs/standards/code/*.md": [10],
    "src/payments/AGENTS.md": [1, 8, 12, 13]
  },
  "angles": { "8": { "severityCeiling": "Important" } }
}
```

The walk up finds `src/payments/AGENTS.md`, a long adapter contract that a search by name never sees. `exclude` drops large glossaries. `angles.8` raises the ceiling: the project declares the cost of an event an invariant, otherwise [angle 8](../angles/8.efficiency.md) stops at `Nit`.

## Boundaries

The config says **where** to look and **where** to route. It does not decide whether a file describes how to write code, and it does not copy rules: the bodies live in their files, the config points at them.
