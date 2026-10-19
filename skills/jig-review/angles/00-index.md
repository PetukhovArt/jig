# Angles: index

An angle is one concrete question to the diff, with a procedure for answering it and a condition for evidence. Not a topic and not a checklist.

A finder carries several angles and reads the diff once. A section for every assigned angle is required, an empty one too ("angle 2: nothing"); otherwise the finder is asked again. An angle that names an atom: read `<root>/atoms/<name>.md` before the hunt; it holds the criterion.

## Bugs: survive ONLY as `CONFIRMED` with initiator, path, effect

Every finder gets the whole diff. The questions are split, not the material.

- [1](1.line-by-line.md) · line by line: errors inside a line and a function
- [2](2.removed-behavior.md) · removed behavior: what was lost with the removed code
- [3](3.call-tracing.md) · call tracing: what breaks for the callers
- [4](4.language-traps.md) · language traps: the pitfalls of the language
- [5](5.wrappers.md) · wrappers and proxies: something not forwarded to the wrapped object
- [12](12.guard-siblings.md) · guard without siblings: a check added in one place of several
- [14](14.security.md) · security: a sink in the diff with a path from untrusted input

## Rules: survive ONLY as `CONFIRMED` of the rule form, own finder

- [6](6.reuse.md) · reuse: written what already exists
- [10](10.conventions.md) · conventions and smells: written project rules broken, a code shape from the smell vocabulary
- [13](13.architecture.md) · architecture: rules of abstractions and layers, ADRs in force, glossary terms

A duplicate without an invariant and a convention without effect on behavior are not findings ([shape gate](../gates/shape.md#shape-gate)).

## Cleanup: survives ONLY as `CONFIRMED`

Simplifications 7 and 8 never become threads: they go as items into the one FYI note. 16 and 17 stay threads ([shape gate](../gates/shape.md#shape-gate)).

- [7](7.simplification.md) · simplification: the same behavior with less code
- [8](8.efficiency.md) · efficiency: extra work and leaks
- [9](9.fix-altitude.md) · fix altitude: fixed at the wrong level, a feature branch in a foreign flow, a reshape removes a branch whole
- [11](11.docs.md) · documents in the diff: will the document go stale; does a changed ADR or glossary agree
- [16](16.tests.md) · redundant tests, by atom `tests`
- [17](17.comments.md) · redundant comments, by atom `comments`

## Spec: survives ONLY as `CONFIRMED`, with the rules finder when a spec is found

- [15](15.spec.md) · spec conformance: missing, unrequested, done differently

Which angles a run starts and each ceiling: [selector](../references/selector.md). Layout over agents: [`../steps/04-finders.md`](../steps/04-finders.md). Turning an angle off: `angles.<n>.enabled: false` in the [project config](../references/project-config.md).
