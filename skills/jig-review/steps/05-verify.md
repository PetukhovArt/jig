# Verify

The subagent path ([layout](01-prepare.md#layout)). This step is for you, the orchestrator; the judges read the [gate files](#gate-files), not this file.

## Dedup

**Required before verify.** The key is `root` plus mechanism ([finder output](04-finders.md#what-a-finder-returns)): candidates with one key collapse into one, even when they point at different lines of the chain. Keep the most concrete failure scenario and the root line; the other lines of the chain become evidence. Without `root` the key is the line. One defect reported by five finders at three different lines of one chain did not collapse under the key "line"; that is why `root` exists.

Several finders that raised one defect reach verify as ONE candidate: otherwise one defect eats the judge's budget twice and reaches the author as two threads. Record which finders and which models raised it: two models finding one defect independently is the strongest signal the run has.

One line with **different** mechanisms: two candidates, never merged.

Two finders on both ends of one cross-partition chain raise it from their own partitions, at different lines: one `root` collapses them like any other chain; the `cross:` links they name join the evidence.

## Cross-partition candidates

A candidate with `cross:` ([finder output](04-finders.md#what-a-finder-returns)) is judged on both sides: whoever judges it (a judge subagent, or you under `lean`) reads the code on the other side at the `file:line` it names before the verdict, and the verdict quotes the code on both sides. The link is not there: `REFUTED`, with the line that shows it.

## Head before verify

Mode `review` with state on only. While finders ran, the author may have pushed fixes, and judges spent turns on `REFUTED: fixed in <sha>`.

Read the head from the forge, never from the local checkout: `node "<root>/bin/jig.mjs" review-cycle head <iid> --reviewed <reviewed HEAD>`. The worktree stays at the reviewed commit while the author pushes, so its own `HEAD` never moves; one runner reported "the head did not move" from it while five commits had landed. `UNCHANGED`: go on. `MOVED <reviewed> <new> commits=N` (exit 1): `git fetch`, then `git diff <reviewed>..<new>` on the candidates' files. A candidate whose line this diff changed or removed is dropped without a judge and counted in `tally.suppressed_stale`. The rest are judged against the reviewed tree. `last_reviewed_sha` stays the reviewed HEAD ([output](08-output.md)), so the next run sees the push as an increment: the dropped code is not lost. Summary: `head moved: <old8>→<new8>, dropped N`.

## Layout lean

Only when `jig review-plan` printed `layout: lean`: you judge every candidate; one judge subagent on another model takes only the `Important` ones.

### Judge yourself

Judge every deduped candidate by the gate files the steps list (`gates/bugs.md` for bug angles 1–5, 12, 14; `gates/shape.md` for the rest; `gates/severity.md` always). The finders' candidates share their blind spots with you when you read only what they quoted: ask the self-check of `gates/bugs.md` literally before each bug `CONFIRMED`, judge a [cross-partition](#cross-partition-candidates) candidate on both sides, and refute with a quoted line, not with doubt.

Per candidate record what a judge returns: verdict, severity, `severity_class`, `severity_gate` when a gate cut it, angle, category, and a one-sentence `summary` naming the defect plus the evidence the verdict rests on (the quoted line, the input, the state). No comment prose: texts come in a [separate step](07-comments.md).

### Second model, only for Important

No `CONFIRMED` `Important` after your own gates: no subagent; the output says `judge: you only (no Important candidate)`.

One or more: spawn **one** judge subagent for all of them, role `verifier`, fresh, in the foreground, on the model and grade `jig review-plan` printed (`candidates from <model A> → judge <model B>`; a tier with one model: the summary says `judge: same model as the finder`). Brief, in this order:

1. the diff index `jig review-plan` printed under `diff files:` (the judge reads its candidates' files by their line ranges in the parts);
2. the Important candidates with your evidence;
3. the project's severity sections verbatim ([source](02-rules.md#severity-source)); no project section: the path `<skill>/gates/severity.md` instead;
4. the angle ceilings from the config when set, facts and decisions ([prepare](01-prepare.md#facts-and-decisions)), on a re-review the **fix-hunk map** ([re-review](09-rereview.md));
5. paths only: the gate files of these candidates' classes (`<skill>/gates/bugs.md` for bug angles, `<skill>/gates/shape.md` for the rest, `<skill>/gates/severity.md` always) and the role template `<root>/skills/jig/references/roles/verifier.md`. Never paste the gate text.

Never `sleep` and never poll its output.

**Its verdict stands.** `CONFIRMED` by it: the item carries "two models". `REFUTED`: the candidate goes to the refuted list with the judge's reason. You still hold a quoted line it ignored: apply its verdict anyway and log the doubt as `runner disagrees: <id> · <reason>` ([output](08-output.md#output)). A severity it lowered stands with its `severity_gate`.

## Layout solo

Only when `jig review-plan` printed `layout: solo`: every finder returned a verdict per candidate ([finders](04-finders.md#layout-solo)). No judge subagents, no clusters.

- A `CONFIRMED` that lacks a field the gates require (a bug without initiator, path or effect quoted; a rule without its quote) is `REFUTED: not proven`, unless you prove the missing part yourself with a quoted line.
- Two finders that judged one deduped candidate differently: read the cited lines and decide; name the disagreement in the output.
- `REFUTED` candidates go to the refuted list with the finder's reason.

## Check the class codes

Before [ranking](06-rank.md): a class outside the taxonomy in force, or a severity below the class level without `severity_gate` ([class code](../gates/severity.md#class-code)): the candidate goes back once to the same judge with the mismatch named. A repeat: the severity of the class level, and the mismatch goes into the summary.
