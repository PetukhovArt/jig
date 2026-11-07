# Angles: index

An angle is one concrete question to the diff, with a procedure for answering it and a condition for evidence. Not a topic and not a checklist.

A finder carries several angles and reads the diff once. A section for every assigned angle is required, an empty one too ("angle 2: nothing"); otherwise the finder is asked again. An angle that names an atom: read `<root>/atoms/<name>.md` before the hunt; it holds the rules the angle applies.

**What the review does not hunt.** Code shape the project's tooling can own (duplication, naming, style, layers and imports, comments, documents) is not an angle: a review spends a deep model on what a linter, a type checker or an architecture check proves for free, and its threads turn into nitpicks. A project that wants such a check in its review adds it as its own angle of kind `conventions` ([project config](../references/project-config.md)); better, it moves the rule into a check that blocks the merge.

## Bugs: survive ONLY as `CONFIRMED` with initiator, path, effect

Every finder gets the whole diff. The questions are split, not the material.

- [1](1.line-by-line.md) · line by line: errors inside a line and a function
- [2](2.removed-behavior.md) · removed behavior: what was lost with the removed code
- [3](3.call-tracing.md) · call tracing: what breaks for the callers
- [4](4.language-traps.md) · language traps: the pitfalls of the language
- [5](5.wrappers.md) · wrappers and proxies: something not forwarded to the wrapped object
- [12](12.guard-siblings.md) · guard without siblings: a check added in one place of several
- [14](14.security.md) · security: a sink in the diff with a path from untrusted input

## Efficiency: survives ONLY as `CONFIRMED` with the proven rate

- [8](8.efficiency.md) · efficiency: leaks, CPU load the user feels, work on a proven hot path

## Spec: survives ONLY as `CONFIRMED`, when a spec is found

- [15](15.spec.md) · spec conformance: missing, unrequested, done differently

## Tests: survive ONLY as `CONFIRMED`, when the diff adds or changes tests

- [16](16.tests.md) · wrong and redundant tests, by atom `tests`

The numbers keep the gaps of removed angles: state files and project configs name angles by number, and a number never changes its meaning.

Which angles a run starts and each ceiling: [selector](../references/selector.md). Layout over agents: [`../steps/04-finders.md`](../steps/04-finders.md). Turning an angle off: `angles.<n>.enabled: false` in the [project config](../references/project-config.md).
