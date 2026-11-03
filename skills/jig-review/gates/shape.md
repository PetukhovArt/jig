# Gates: efficiency 8, spec 15 and project convention angles

A judge of a cluster with such candidates reads this file and [severity](severity.md). The main session reads it when it judges ([verify](../steps/05-verify.md#judge-yourself)).

## Verdict

- Spec 15 and a project angle of kind `conventions`: only **`CONFIRMED` of the rule form**. A rule violation has no input, so no producer is asked for. Three conditions: the angle's evidence is complete as its file writes it (the rule quote, the spec quote); the violating diff line is quoted; the rule is not covered by the repository's tooling, checked against its config, not from memory.
- Efficiency 8: only `CONFIRMED`, with the evidence its angle file names.
- Anything missing: `REFUTED` with the missing condition named and the proving line quoted. Both go into `summary`.

Both classes then pass the [shape gate](#shape-gate).

## Shape gate

A shape with no behavior and no invariant is not a finding:

- **Duplicate**: a finding only when the copy holds an invariant: validation, access rights, money, synchronization, a value that must match (a protocol limit, a wire format). The evidence names the invariant and the place where the copies will diverge. Copies alike in shape with no invariant: `REFUTED`, reason "duplicate without an invariant".
- **Convention without effect on behavior**: where a comment or helper lives, which layer a pure codec sits in, code order: `REFUTED`.
- **Correct code that could be shorter or faster** off a proven hot path: `REFUTED`. A finding that need not be fixed must not look like a task.
