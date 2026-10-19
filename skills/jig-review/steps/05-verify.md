# Verify, gates, severity

## Dedup

**Required before verify.** The key is `root` plus mechanism ([finder output](04-finders.md#what-a-finder-returns)): candidates with one key collapse into one, even when they point at different lines of the chain. Keep the most concrete failure scenario and the root line; the other lines of the chain become evidence. Without `root` the key is the line. One defect reported by five finders at three different lines of one chain did not collapse under the key "line"; that is why `root` exists.

Several finders that raised one defect reach verify as ONE candidate: otherwise one defect eats the judge's budget twice and reaches the author as two threads. Record which finders and which models raised it: two models finding one defect independently is the strongest signal the run has.

One line with **different** mechanisms: two candidates, never merged.

## Head before verify

Mode `review` with a known merge request only. While finders ran, the author may have pushed fixes, and judges spent turns on `REFUTED: fixed in <sha>`.

Read the current head ("Read a merge request" in `forge.md`). Equal to the reviewed HEAD: go on. Moved: `git fetch`, then `git diff <reviewed>..<new>` on the candidates' files. A candidate whose line this diff changed or removed is dropped without a judge and counted in `tally.suppressed_stale`. The rest are judged against the reviewed tree. `last_reviewed_sha` stays the reviewed HEAD ([output](08-output.md)), so the next run sees the push as an increment: the dropped code is not lost. Summary: `head moved: <old8>→<new8>, dropped N`.

## Verify

Survivors of dedup are clustered **by their nearest common directory and by the model of the finder that raised them**, with limits: ≤ 5 candidates AND ≤ 3 files per cluster. One file read amortizes over about 5 judgments; past that the late candidates get a shallower look, and more than three files per judge has the same effect from switching. A candidate raised by several models goes with the first of them.

**Directory, not file.** The key "file" on a wide diff makes a cluster per candidate: with 20 candidates over 90 files collisions are rare, and the constant part of the brief is paid as many times as there are candidates. A directory groups neighbours whose reads overlap anyway. A dump directory (`shared/ui`) groups unrelated things: the 3-file limit guards against that, not the key.

One judge subagent per cluster, role `verifier`, tier and effort from its template, in parallel across clusters within the [subagent cap](../SKILL.md#rules-for-the-whole-run); a refused spawn joins the [queue](04-finders.md#refused-spawn). It reads its files once and judges all its candidates.

**The judge runs on a different model of its tier than the finder whose candidates it judges.** `jig review-plan` prints the pairs (`candidates from opus → judge sonnet`). A defect that survives a second model is the "two models found it" signal; a judge on the finder's own model shares its blind spots. The tier has one model only: use it, and the summary says `judge: same model as the finder`.

**Input:** the diff, the files it needs, the cluster's candidates, the project's severity sections verbatim ([source](02-rules.md#severity-source)), facts and decisions ([prepare](01-prepare.md#facts-and-decisions)) and, on a re-review, the **fix-hunk map** ([re-review](09-rereview.md)).

**Cut the brief to the cluster's angles.** Gates, calibration and severity rules go only for the classes present in the cluster: a cluster of bugs gets neither the rule form of `CONFIRMED` nor the cleanup rules. A shared brief for every judge is a constant part multiplied by agents and by their turns.

**The cost of the key, named honestly:** one judge per directory calibrates its strictness itself, and the bar may drift between directories. The literal gate wording below, identical in every brief, holds it, not the number of judges.

**Returned per candidate, in one go:**

- **verdict**: see "Verdict";
- **severity**, **severity_class**, **severity_gate**: see "Severity";
- **blocks**: only for a blocking finding, see "Blocking finding";
- **angle**: the number of the angle that raised it; the [selector](../references/selector.md) filters by it;
- **category**: the slug of the angle that raised it, one of the nine in [`../references/state-schema.md`](../references/state-schema.md). `docs`, `design`, `style`, `test-coverage` are not categories: documentation drift is `correctness` at Nit, a design smell is `altitude`, `simplification` or `architecture` with a broken rule. An angle that does not map means the candidate belongs to no angle: drop it;
- **summary**: one sentence naming the defect plus the evidence the verdict rests on: the quoted line, the input, the state. **No comment prose here**: verify judges, it does not write. Texts come in a [separate step](07-comments.md), after the gate, so nothing is written for a candidate that dies.

## Verdict

- `CONFIRMED` for a bug angle: the bug is proven in three parts, each with a quote:
  - **initiator**: a user action, a system event or a backend response in a production build. A trigger that exists only in development (hot reload, a dev flag, a mock) is not an initiator;
  - **path**: `file:line` for every step from the initiator to the defective line, with the producer of the input: who writes this state, who passes this argument. An input the code does not control is named as a place, not a category ([forms below](#bug-calibration));
  - **effect**: observable by the user and wrong by the requirement: the spec, a recorded decision, the task's scenario. Differing from neighbouring code does not prove wrongness: neighbours may have other scenarios.
- `REFUTED`: factually wrong, covered elsewhere, or not proven: no initiator, the path breaks, the effect is not named or is correct by the requirement. The reason is named and the proving line quoted. Both go into `summary`: the "Refuted" section of the [output](08-output.md#output) prints from it.

A bug has no third verdict: "the mechanism is real, the trigger is not proven" is `REFUTED` with the reason "not proven".

**The judge's self-check before every `CONFIRMED` of a bug angle, verbatim in the brief:** "Who is the initiator in production, where is the path to the effect, and why is the effect wrong by the requirement? No quote for any one of them: not CONFIRMED." Models put CONFIRMED on hypothetical state readily; the question at the moment of the verdict is the only thing that stops it.

Two Nits reached threads on an unproven input: "entering a value loses its seconds" (the mechanism is real, but the effect is intended: that field takes the whole value in exactly that format) and "no limit on entered values" (no path from that input field was named, and the author checked another input). Both are `REFUTED: not proven`.

**`CONFIRMED` of the rule form** for angles 6, 10, 13 and 15. A rule violation has no input, so no producer is asked for. Three conditions: the angle's evidence is complete as its file writes it (the rule quote, the smell name, the symbol path, the spec quote); the violating diff line is quoted; the rule is not covered by the repository's tooling, checked against its config, not from memory. Any of the three missing: `REFUTED` with the condition named.

### Gate by angle class

- bugs 1–5, 12, 14 → only `CONFIRMED` with initiator, path and effect, then the [rare gate](#rare-gate);
- rules 6, 10, 13 and spec 15 → only `CONFIRMED` of the rule form;
- cleanup 7, 8, 9, 11, 16, 17 → only `CONFIRMED`.

Rules and cleanup also pass the [shape gate](#shape-gate).

### Shape gate

Rules and cleanup prove the shape of code, not a defect. A shape with no behavior and no invariant is not a finding; verbatim in the judge brief:

- **Duplicate**: a finding only when the copy holds an invariant: validation, access rights, money, synchronization, a value that must match (a protocol limit, a wire format). The evidence names the invariant and the place where the copies will diverge. Copies alike in shape with no invariant: `REFUTED`, reason "duplicate without an invariant". Three copies of `escapeRegExp`, four copies of a one-line "is this a Duration" predicate and a CSS class repeating another reached threads before this gate.
- **Convention without effect on behavior**: where a comment or helper lives, which layer a pure codec sits in, code order: `REFUTED`. Placement stays a finding only when it breaks an import direction or a module boundary, or gives a concept a second owner ([angle 13](../angles/13.architecture.md)).
- **Exceptions that stay threads:** a redundant test ([angle 16](../angles/16.tests.md): repeats another test or cannot fail on its own) and a redundant comment ([angle 17](../angles/17.comments.md): outside the allowlist, or contradicted by the code). They have no behavior, but both pollute the context of later model runs: they read them as truth about the code.
- **Simplification**: the code is correct but can be shorter: a double `trim`, a value computed three times, a literal that should be derived. `CONFIRMED` of [angle 7](../angles/7.simplification.md) and [angle 8](../angles/8.efficiency.md) without a leak and without a proven hot path gets `status: "optional"` and never becomes a thread: it goes as an item into one optional note ([output](08-output.md)). A finding that need not be fixed must not look like a task.

## Bug calibration

**The class of a defect argues neither way:** a race between async flows, null on a rare path, falsy zero, an off-by-one at a boundary, a retry storm, an unanchored regex, a stale closure, an unhandled reject. Path built: `CONFIRMED`; not built: `REFUTED`.

**The path to the mechanism** has two legitimate forms, no others:

1. a caller, input or state inside the code: quote the call site or the field that feeds it;
2. a trigger the code does not control: a backend response, concurrency, the clock, the environment, the config, an exported symbol with callers outside the repository. **Name the place, not the category**; the word "concurrency" or "config" is not a path:
   - backend response → the response field plus the line that reads it;
   - concurrency → two concrete calls that can interleave, both quoted;
   - config or environment → the key plus the file where it is set;
   - clock → the line that reads the time plus the window in which the value is wrong;
   - external caller → the exported symbol plus a real call outside the repository.

   Plus the guard that would have excluded the trigger.

**A race, a late async response, a lifecycle order** (a response after logout, a load across a user switch, dispose before resolve): the place is the **trigger path** from the user action to the race, `file:line` per step: which action, who calls teardown, dispose or reset, what is in flight at that moment. The path built in full: judge by the forms above. The path breaks: `REFUTED` with "not proven", into `suppressed_speculative`.

No form: `REFUTED`, "not proven". A category instead of a place: also "not proven".

This kills a finding that exists only because the shape of the code allows it, and keeps every timing, environment and config defect whose path is named.

`REFUTED` with "not proven" is counted in `suppressed_speculative`, otherwise the bar cannot be tuned. Other `REFUTED` are not counted: they are about a wrong fact, not unproven reachability.

**Both errors are live.** A missed real defect costs exactly as much as an invented one. `REFUTED: not proven` is legitimate only after the initiator and the path were **searched for**, not because they were absent from the file already open. Searched and not completed: the `summary` says at which step the path broke; a silent `REFUTED` is indistinguishable from a miss.

## Rare gate

A proven bug is not reported as a task when both hold:

- the input is off the happy path, not the task's main scenario: an extreme value, a hand-edited file, a rare sequence of actions;
- the fix adds code: a guard, a branch, new state, rather than deleting code or narrowing a type.

Recoverability is not a condition: "reload" or "fix it by hand" fits almost any front-end bug, and a wrong value in front of an operator mid-shift is not safe because it can be fixed later.

Exceptions where rarity does not matter: data loss or corruption, security, a broken system invariant.

Such a finding is a known risk, not a task: it goes into neither state nor threads, is counted in `tally.suppressed_rare`, and gets one summary line `known risks: <file> · <defect>`. The author fixes everything a thread shows, so a thread on an unneeded fix turns into extra code.

## Severity

Two parts with different owners:

- **taxonomy**: which defect classes are `Important` and which `Nit`. The [project severity](02-rules.md#severity-source) exists → only it applies; the default below applies neither whole nor in parts. None → the default below;
- **gates**: when severity is cut regardless of class. They always apply; a project cancels a gate only explicitly, by naming it.

`angles.<n>.severityCeiling` from the [config](../references/project-config.md) stands over both: it sets the ceiling of that angle's findings instead of the default, up or down. `angles.<n>.enabled: false` turns the angle off before any finder spawns.

### Default taxonomy

`Important`: the merge waits for the fix. Either behavior breaks, or the diff lays down a structure the next code will build on, and after the merge its fix gets dearer with every edit on top. The classes are closed; the class code in brackets:

- **Behavior:** broken behavior (`broken`), data loss (`data-loss`), crash (`crash`).
- **Layers and placement** (`layer`, [angle 13](../angles/13.architecture.md), sections A and B):
  - the direction or visibility of layers from the architecture document is broken: a lower layer imports an upper one (section B);
  - module internals through its boundary, an import bypassing the public index (section A);
  - a module in the wrong place: new code went into a module or layer that does not own the concept, while an owner is named (section A).
- **Spread across modules** (`spread`, angle 13):
  - a section A rule with a second participant in another module: duplicated ownership, a second copy of a responsibility, hidden coupling;
  - the code contradicts an ADR in force (section C): the decision is recorded, the code does otherwise, and the next reader will trust the document;
  - an `_Avoid_` synonym or a name differing from the glossary term (section D) in an exported symbol: a type, an event, an API field, a URL segment.
- **Structural smell** (`smell`, [angle 10](../angles/10.conventions.md) and the god object of section A): a structural smell from atom `smells` with a named second participant. A project vocabulary has its own scale, and it wins.

`Nit` (`nit`): worth fixing, does not block the merge. Everything outside the classes above: a section A rule with both participants in one module (except the god object), other smells, a glossary term in an internal symbol, a concept without an entry.

### Gates

The gate code in brackets.

- `Pre-existing` (`pre-existing`): lives in untouched lines of touched code; kept only with an Important class.
- A documentation finding (README drift, a broken link, a stale comment): at most `Nit` (`docs`), whatever the focus note stresses.
- Cleanup: `Nit` (`cleanup`), except a `CONFIRMED` memory leak ([angle 8](../angles/8.efficiency.md)): it follows the general rules.
- A secret in the diff ([angle 14](../angles/14.security.md)): `Important` with no input.
- A latent defect (fires only on a future edit): `Important` only when THIS diff sets the trap and the failure will be silent: no test, validation or error will catch it. Latent and loud, latent and pre-existing → `Nit` (`latent`) / `Pre-existing`.
- The angle ceiling from the config (`ceiling`).
- The focus directs attention, not severity. Rarity of the input does not lower severity: a bug that passed the rare gate gets the severity of its class.

### Class code

The judge returns two fields with the severity:

- **`severity_class`**: the class code from the taxonomy in force: `I2`, `N3` for a project, `data-loss`, `nit` by default;
- **`severity_gate`**: the gate code, only when a gate cut the severity below the class level.

The orchestrator checks them before [ranking](06-rank.md). A class outside the taxonomy in force, or a severity below the class level without `severity_gate`: the candidate goes back once to the same judge with the mismatch named. A repeat: the severity of the class level, and the mismatch goes into the summary. A judge gave `Nit` to erased user input that the project rated `I2`: nobody asked for the class, and the error showed only in the thread.

### Blocking finding

An `Important` of angle 13 whose fix moves or rewrites code other findings stand on: logic moves to another module, a store splits. The judge returns `blocks` (the files the fix rewrites) and names in `summary` where the code goes. No place named: no `blocks`, since without it nobody knows what to mute. What the output does with the neighbours: [ranking](06-rank.md).
