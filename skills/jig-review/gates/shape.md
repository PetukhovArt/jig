# Gates: rule angles 6, 10, 13, 15 and cleanup angles 7, 8, 9, 11, 16, 17

A judge of a cluster with rule or cleanup candidates reads this file and [severity](severity.md). The main session reads it on the inline path ([step 04](../steps/04-inline.md)).

## Verdict

- Rules 6, 10, 13 and spec 15: only **`CONFIRMED` of the rule form**. A rule violation has no input, so no producer is asked for. Three conditions: the angle's evidence is complete as its file writes it (the rule quote, the smell name, the symbol path, the spec quote); the violating diff line is quoted; the rule is not covered by the repository's tooling, checked against its config, not from memory.
- Cleanup 7, 8, 9, 11, 16, 17: only `CONFIRMED`, with the evidence its angle file names.
- Anything missing: `REFUTED` with the missing condition named and the proving line quoted. Both go into `summary`.

Both classes then pass the [shape gate](#shape-gate).

## Shape gate

Rules and cleanup prove the shape of code, not a defect. A shape with no behavior and no invariant is not a finding:

- **Duplicate**: a finding only when the copy holds an invariant: validation, access rights, money, synchronization, a value that must match (a protocol limit, a wire format). The evidence names the invariant and the place where the copies will diverge. Copies alike in shape with no invariant: `REFUTED`, reason "duplicate without an invariant". Three copies of `escapeRegExp`, four copies of a one-line "is this a Duration" predicate and a CSS class repeating another reached threads before this gate.
- **Convention without effect on behavior**: where a comment or helper lives, which layer a pure codec sits in, code order: `REFUTED`. Placement stays a finding only when it breaks an import direction or a module boundary, or gives a concept a second owner ([angle 13](../angles/13.architecture.md)).
- **Exceptions that stay threads:** a redundant test ([angle 16](../angles/16.tests.md): repeats another test or cannot fail on its own) and a redundant comment ([angle 17](../angles/17.comments.md): outside the allowlist, or contradicted by the code). They have no behavior, but both pollute the context of later model runs: they read them as truth about the code.
- **Simplification**: the code is correct but can be shorter: a double `trim`, a value computed three times, a literal that should be derived. `CONFIRMED` of [angle 7](../angles/7.simplification.md) and [angle 8](../angles/8.efficiency.md) without a leak and without a proven hot path gets `status: "optional"` and never becomes a thread: it goes as an item into the one FYI note. A finding that need not be fixed must not look like a task.
