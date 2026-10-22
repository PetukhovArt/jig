# Verify

The subagent path ([layout](01-prepare.md#layout)). This step is for you, the orchestrator; the judges read the [gate files](#gate-files), not this file.

## Dedup

**Required before verify.** The key is `root` plus mechanism ([finder output](04-finders.md#what-a-finder-returns)): candidates with one key collapse into one, even when they point at different lines of the chain. Keep the most concrete failure scenario and the root line; the other lines of the chain become evidence. Without `root` the key is the line. One defect reported by five finders at three different lines of one chain did not collapse under the key "line"; that is why `root` exists.

Several finders that raised one defect reach verify as ONE candidate: otherwise one defect eats the judge's budget twice and reaches the author as two threads. Record which finders and which models raised it: two models finding one defect independently is the strongest signal the run has.

One line with **different** mechanisms: two candidates, never merged.

## Head before verify

Mode `review` with state on only. While finders ran, the author may have pushed fixes, and judges spent turns on `REFUTED: fixed in <sha>`.

Read the current head ("Read a merge request" in `forge.md`). Equal to the reviewed HEAD: go on. Moved: `git fetch`, then `git diff <reviewed>..<new>` on the candidates' files. A candidate whose line this diff changed or removed is dropped without a judge and counted in `tally.suppressed_stale`. The rest are judged against the reviewed tree. `last_reviewed_sha` stays the reviewed HEAD ([output](08-output.md)), so the next run sees the push as an increment: the dropped code is not lost. Summary: `head moved: <old8>→<new8>, dropped N`.

## Clusters

Survivors of dedup are clustered **by their nearest common directory and by the model of the finder that raised them**, with limits: ≤ 5 candidates AND ≤ 3 files per cluster. One file read amortizes over about 5 judgments; past that the late candidates get a shallower look, and more than three files per judge has the same effect from switching. A candidate raised by several models goes with the first of them.

**Directory, not file.** The key "file" on a wide diff makes a cluster per candidate: with 20 candidates over 90 files collisions are rare, and the constant part of the brief is paid as many times as there are candidates. A directory groups neighbours whose reads overlap anyway. A dump directory (`shared/ui`) groups unrelated things: the 3-file limit guards against that, not the key.

**The cost of the key, named honestly:** one judge per directory calibrates its strictness itself, and the bar may drift between directories. The literal gate wording, identical in every judge's gate files, holds it, not the number of judges.

## Judges

One judge subagent per cluster, role `verifier`, tier and effort from its template, in parallel across clusters within the [subagent cap](../SKILL.md#rules-for-the-whole-run); a refused spawn joins the [queue](04-finders.md#refused-spawn). It reads its files once and judges all its candidates.

**The judge runs on a different model of its tier than the finder whose candidates it judges.** `jig review-plan` prints the pairs (`candidates from opus → judge sonnet`). A defect that survives a second model is the "two models found it" signal; a judge on the finder's own model shares its blind spots. The tier has one model only: use it, and the summary says `judge: same model as the finder`.

**Fork or fresh, in the foreground.** A judge whose model is your own is forked after dedup, as [finders](04-finders.md#shared-context) are: it inherits the diff, the read set and the candidates. Others are spawned fresh with the brief below. Run them in the foreground; never `sleep`, never read their output files in a loop: each such turn re-sends the whole context.

### Gate files

A judge reads only the gate files of the angle classes in its cluster, by path; never paste their text into the brief and never send it this file:

- bug angles 1–5, 12, 14 → `<skill>/gates/bugs.md`;
- rule angles 6, 10, 13, 15 and cleanup angles 7, 8, 9, 11, 16, 17 → `<skill>/gates/shape.md`;
- every judge → `<skill>/gates/severity.md`.

A cluster of bugs gets neither the rule form nor the cleanup rules: a shared brief for every judge is a constant part multiplied by agents and by their turns.

### Brief

In this order: the diff index `jig review-plan` printed under `diff files:` (the judge reads its cluster's files' ranges from the parts), the `already read` list, the files the cluster needs, the cluster's candidates, the project's severity sections verbatim ([source](02-rules.md#severity-source)), the angle ceilings from the config when set, facts and decisions ([prepare](01-prepare.md#facts-and-decisions)), on a re-review the **fix-hunk map** ([re-review](09-rereview.md)), then the gate file paths and the role template path `<root>/skills/jig/references/roles/verifier.md`.

**Returned per candidate, in one go:** verdict, severity, `severity_class`, `severity_gate`, `blocks` (a blocking finding only), angle, category, and a one-sentence `summary` naming the defect plus the evidence the verdict rests on: the quoted line, the input, the state. **No comment prose**: verify judges, it does not write. Texts come in a [separate step](07-comments.md), after the gate, so nothing is written for a candidate that dies.

## Layout lean

Only when `jig review-plan` printed `layout: lean`: the finders ran on the deep tier, and instead of a judge per cluster you judge, as on the [inline path](04-inline.md#judge-yourself). Head before verify and clusters do not apply.

1. Judge every deduped candidate yourself by the gate files the steps list, the self-check of `gates/bugs.md` asked literally before each bug `CONFIRMED`; refute with a quoted line, not with doubt.
2. No `CONFIRMED` `Important`: no subagent; the output says `judge: you only (no Important candidate)`.
3. One or more: **one** judge subagent for all of them, role `verifier`, on the model and grade `jig review-plan` printed (`candidates from sonnet → judge opus`), briefed as the [inline judge](04-inline.md#second-model-only-for-important). Its verdict stands, as there.

## Layout solo

Only when `jig review-plan` printed `layout: solo`: every finder returned a verdict per candidate ([finders](04-finders.md#layout-solo)). No judge subagents, no clusters.

- A `CONFIRMED` that lacks a field the gates require (a bug without initiator, path or effect quoted; a rule without its quote) is `REFUTED: not proven`, unless you prove the missing part yourself with a quoted line.
- Two finders that judged one deduped candidate differently: read the cited lines and decide; name the disagreement in the output.
- `REFUTED` candidates go to the refuted list with the finder's reason.

## Check the class codes

Before [ranking](06-rank.md): a class outside the taxonomy in force, or a severity below the class level without `severity_gate` ([class code](../gates/severity.md#class-code)): the candidate goes back once to the same judge with the mismatch named. A repeat: the severity of the class level, and the mismatch goes into the summary.
