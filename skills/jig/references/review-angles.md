# Review angles

An angle is one concrete question to the diff, with what to look for and what counts as evidence. Not a topic and not a checklist. Spawn one `finder` per angle the diff touches; every finder gets the whole diff: the questions are split, not the material. A finder reports every assigned angle, an empty one too (`angle 2: nothing`).

Atoms named below hold the criteria; the finder reads them before the hunt. Every candidate carries `file:line` and the evidence the angle asks for. The `verifier` confirms bugs by an initiator → path → effect trace or a reproduction, and rules by the quoted rule plus the violating line.

## Bugs

### 1. Line by line
Look for: every hunk, then the whole function around it; per line, which input, state, timing or platform makes it wrong. Inverted condition, off-by-one at a boundary, access on `null`/`undefined`, a missing `await`, zero taken for empty, a swallowed `catch`, a copied line with the wrong variable, unescaped regex metacharacters. A bug in an untouched line of a touched function is in scope.
Evidence: the quoted line plus the input on which it gives a wrong result.
Atoms: evidence, typescript.

### 2. Removed behavior
Look for: every removed or replaced line. Name in words the rule it held (a check, an order, a cleanup, a default, a resource release) before searching, then find where the new code restores it. Not found: candidate.
Evidence: the removed line plus where exactly the rule no longer holds.
Atoms: change-impact.

### 3. Call tracing
Look for: every changed function. Grep its callers and callees: a new precondition, a changed return shape, a new exception, a new dependency on call order, a neighbouring edit in the same diff that makes an existing call unsafe.
Evidence: both sides: the changed contract and the call site that no longer fits it.
Atoms: change-impact.

### 4. Language traps
Look for: `==` with coercion, a stale closure over a mutable variable, a promise without `await` or a lost reject, a race between parallel async flows, `any` and `as` hiding a real type mismatch, time zones and DST, float equality. The project's rules may add framework traps.
Evidence: the quoted line plus the named mechanism.
Atoms: typescript, effects.

### 5. Wrappers and proxies
Look for: a type wrapping another (cache, adapter, decorator, proxy). Routing: every method calls the wrapped instance, not a fresh lookup through a registry or a global (re-entry, recursion). Completeness: every method callers use is exposed.
Evidence: the method line that goes to the wrong place, or the call of a method the wrapper lacks.
Atoms: boundaries.

### 6. Guard without siblings
Look for: a hunk that adds a guard, early return, validation or branch, i.e. a new invariant. State the invariant in one sentence without naming the file; grep each symbol of the guard's condition across the whole tree; a sibling is a place with the same precondition and no guard. Zero siblings is a valid answer.
Evidence: both quotes: the guard in the diff and the sibling without it, with the input on which the sibling breaks. Usually pre-existing; important when the failure is silent and costs data.
Atoms: root-causes, change-impact.

### 7. Security
Look for: a sink in the diff plus a path to it from untrusted input. A string reaching an executable context (`innerHTML`, `v-html`, `eval`, `new Function`, SQL or shell built by concatenation); a path or URL built from a user value without normalisation (traversal, open redirect, `file://` in Electron); external data parsed and trusted by shape; a secret in the diff; a removed protection (escape, CSP, `postMessage` origin check, `contextIsolation`, IPC validation); a permission check only on the client.
Evidence: the sink line plus the source of the input. Important by default; a secret in the diff is always important, no input needed. Not a finding: "maybe XSS" without a sink in the diff.
Atoms: boundaries.

## Rules

### 8. Reuse
Look for: the diff re-implements a helper, hook, util or component the project already has.
Evidence: the existing implementation's path plus the invariant the copy holds. A copy without an invariant (a one-line predicate, the same CSS) is not a finding.
Atoms: one-way.

### 9. Conventions and smells
Look for: a written project rule the hunk breaks (naming, types, imports, literals count when a project document writes them), and a named smell from the project's vocabulary or atom smells.
Evidence: the quoted rule plus the violating line; for a smell: its name, the hunk line and the second participant of the shape (the second copy, the foreign field). Not a finding: a rule the project's tooling already enforces (check its config), a written rule with no effect on behavior.
Atoms: smells, typescript.

### 10. Architecture
Look for: a module exporting its internals; a god object; variability solved by branching in application code where an adapter or registry belongs; an abstraction with one consumer; an orchestrator owning state; hidden coupling (shared mutable state, an event contract by convention, implicit call order); an anemic model (invariants moved into outside functions, an illegal state representable); code placed in a module that does not own the concept; new code in a zone marked legacy; a list synced by hand with a second list; a second way to do a task while the old one keeps its callers; temporal decomposition; an import that bypasses a public index. Project layer rules, the ADRs in force and the glossary apply only with a quote from the project document.
Evidence: the quoted diff line plus the rule (from this list, or quoted from the project's architecture document, ADR or glossary). Not a finding: "I would split it differently" without a broken rule.
Atoms: boundaries, domain-model, reader-cost, one-way, shared-state, patterns.

## Cleanup

### 11. Simplification
Look for: the same behavior with noticeably less code, or one entity fewer: a one-caller wrapper, an option with no second consumer.
Evidence: the named entity or branch that disappears, plus the claim the behavior does not change. Goes into one optional note on the merge request, not a thread.
Atoms: do-less, reader-cost, dead-code.

### 12. Efficiency
Look for: extra work on a hot path, a closure keeping a large scope alive, an expensive value recomputed per call where one computation is enough.
Evidence: the call site proving the frequency plus the line doing the work. A nit, except a confirmed leak with the quoted holding place (closure, subscription without unsubscribe, listener without remove): important. Extra work off a proven hot path goes into the optional note.
Atoms: why-this-number, effects.

### 13. Fix altitude
Look for: a patch over shared infrastructure where the infrastructure should change; an infrastructure change where a local fix belongs; a feature's branch inserted into a flow it does not own; a patch where another layout of the same diff removes a whole branch, helper or mode.
Evidence: the module that actually owns the decision, with the quoted inserted branch, or what disappears after the reshape and why behavior stays the same.
Atoms: root-causes, do-less.

### 14. Documentation
Look for: every new or changed Markdown file except the changelog. Will it go stale (it retells facts whose source of truth is the code)? Does an ADR or glossary entry agree with the code of the diff and with its neighbours (renamed term, missing index entry, superseded ADR not marked)?
Evidence: the `file:line` of the code the document retells, or both quoted lines that disagree.
Atoms: docs.

### 15. Tests
Look for: every test added or changed in the diff; untouched tests are not judged. A test that does not fail when behavior breaks, or fails when only internals change, or is not warranted at all. Spawn role `test-reviewer` for the changed test files.
Evidence: the test line plus what it asserts. One thread per file.
Atoms: tests.

### 16. Comments
Look for: every comment or JSDoc added or changed in the diff that the allowlist does not cover or the code contradicts.
Evidence: the comment line plus the allowlist item it fails. One thread per file.
Atoms: comments.

## Spec

### 17. Spec conformance
Look for: only when a spec exists (the linked task, an issue, a spec file). Missing: a requirement the diff lacks or implements partially. Unrequested: behavior the spec did not ask for. Done differently: implemented, but contrary to the wording.
Evidence: the spec sentence copied character for character, checked against the latest text of the spec, plus the diff line (or the place where the implementation should be). Missing and done differently are important; unrequested is a nit unless it changes behavior outside the task.
Atoms: evidence.
