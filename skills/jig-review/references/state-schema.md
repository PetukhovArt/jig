# State file schema

`<main checkout>/.jig/runs/review/<KEY>.json` ([state](../steps/03-state.md)):

```json
{
  "key": "…", "remote": "…", "target": "…",
  "source_branch": "…", "base_sha": "…",
  "last_reviewed_sha": "…", "diff_hash": "…",
  "runs": 1,
  "tokens": { "finders": 0, "verify": 0, "compose": 0 },
  "timings": { "started_at": "2026-08-07T16:30:00Z", "finished_at": "2026-08-07T16:34:12Z", "phases": { "finders": 110, "verify": 90, "compose": 25, "outcome": 0 } },
  "tally": { "important": 0, "nit": 0, "optional": 0, "pre_existing": 0, "suppressed_nits": 0, "suppressed_speculative": 0, "suppressed_rare": 0, "suppressed_selector": 0, "suppressed_blocked": 0, "suppressed_stale": 0, "spec": null, "prior_fixed": 0, "prior_skipped": 0, "prior_unverified": 0, "prior_no_change_needed": 0 },
  "findings": [
    {
      "id": "src/api/auth.ts:42:missing-await",
      "file": "src/api/auth.ts", "line": 42,
      "angle": 1, "category": "correctness", "severity": "Important",
      "severity_class": "broken", "severity_gate": null,
      "verdict": "CONFIRMED",
      "models": { "finders": ["opus"], "judge": "sonnet" },
      "summary": "one sentence: the claim only, no reasoning",
      "mrComment": "the full comment, ready to post",
      "caused_by": { "file": "…", "line": 1, "diff_line": "…", "victim_line": "…" },
      "discussion_id": "…",
      "status": "open"
    }
  ],
  "deepening": { "module": "…", "what": "…", "effect": "…", "blast_radius": "…", "sha": "…" }
}
```

## Field semantics

- **`blocks`**: an array of paths, only on a blocking finding ([verify](../gates/severity.md#blocking-finding)). While the finding stands, Nit and Pre-existing in these files are not printed and count in `tally.suppressed_blocked` ([ranking](../steps/06-rank.md)); after `fixed` the re-review reads these files with the full patch ([lifting `blocks`](../steps/09-rereview.md#round-rules)).
- **`caused_by`**: only when the finding's file is outside the diff and the finder proved the causing line inside it. Posting anchors the thread on that line ([posting](posting.md)).
- **`models`**: the models of the finders that raised the finding and of its judge. Two different models is the strongest signal the run reports.
- **`status`**: `open | fixed | skipped | unverified | no_change_needed | optional`. A finding stays under the outcome check until its thread is resolved. Only `fixed` and `no_change_needed` close it, and exactly they resolve the thread. `skipped` (the defect stands) and `unverified` (the check did not run) are silent (nothing is posted or rejudged) but not final: the next run checks again, so a late fix still closes the thread.
  `optional` is a simplification ([shape gate](../gates/shape.md#shape-gate)): there is and will be no thread, `discussion_id` is never set, the outcome check does not take it, it is not counted in `prior_*`. Posting collects all `optional` items into the one unresolvable FYI note as a checklist titled "[🟡 Nit] Improvements: optional, not blocking the merge" ([posting](posting.md#8-the-fyi-note-one-per-merge-request)).
- **`tally.optional`** = this run's simplifications. Not part of `nit`: they do not block the merge. **Absent = 0.**
- **A finding has no other fields.** A field outside this schema is not written: nothing reads it, and its data is lost silently. Thread replies (counter-replies, answers to a developer's reply) do not live in state at all: they are printed with `discussion_id` in the output ([item 5](../steps/08-output.md#output)).
- **`diff_hash`** = `git diff <base>...HEAD | git hash-object --stdin` at the end of the run. Equal to the current value means the code did not change ([re-review](../steps/09-rereview.md)); a rebase does not move it. **Absent = the comparison fails**, the run goes in full.
- **`runs`** = how many finished rounds this key already has; incremented once per run that publishes a tally. It counts rounds BEHIND the current one: a run reading `runs: 3` is round 4. It drives the raised bar ([re-review](../steps/09-rereview.md)). **Absent = 0.** The first run writes `1`. A run that held `last_reviewed_sha` back because the convergence check failed holds the increment back too: the round did not finish.
- **`timings`**: UTC stamps of start and finish plus seconds per phase; a phase that did not run holds `0`. Like `tokens`, this run's numbers replace the earlier ones. A measurement only: no rule reads it to shorten a phase.
- **`suppressed_speculative`** = `REFUTED` with the reason "not proven" in this run: the mechanism exists, the initiator, path or effect does not ([bug calibration](../gates/bugs.md#bug-calibration)). A counter only; the operator sees the candidates as lines in the "Refuted" section ([output](../steps/08-output.md#output), item 8).
- **`suppressed_rare`** = proven bugs cut by the [rare gate](../gates/bugs.md#rare-gate): known risks, not tasks. A counter only; the risks themselves are one line in the summary. **Absent = 0.**
- **`suppressed_stale`** = candidates whose line a push to the merge request changed while the run went on ([head before verify](../steps/05-verify.md#head-before-verify)). A counter only: the next run sees that code as an increment.
- **`tally.spec`** = how many findings [angle 15](../angles/15.spec.md) returned. `null` = no spec found and the angle did not run; `0` = a spec was found and the diff matches it. Consumers tell one from the other only by this field.
- **`tally.degraded`** = a reason string when a phase stopped on a refused spawn ([refused spawn](../steps/04-finders.md#refused-spawn)). **Absent = the run is not degraded.** Present: coverage is below normal, and consumers treat the run as blocked.
- **`spec_quote`**: required on every finding with `category: "spec"`, absent on the rest: the verbatim spec sentence the finding rests on ([angle 15](../angles/15.spec.md#spec_quote)). Consumers search for it in the spec text literally.
- **`source_branch`** = the source branch of the merge request (posting resolves the merge request by it; a re-review checks it out).
- **`base_sha`** = the base of the reviewed diff resolved to a sha (`git rev-parse <base>`). Updated by every run together with `last_reviewed_sha` and `diff_hash`: the triple describes one patch. Scope recovery after a force-push reads it whole ([re-review](../steps/09-rereview.md)); absent or inconsistent with `diff_hash`: the scope falls back to the full diff.
- **`discussion_id`**: set on posting; absent before.
- **`deepening`**: the latest deepening proposal ([selector](selector.md#deepening)): the four parts of its printed item, and `sha`, the HEAD it was proposed on. Not a finding: no status, no thread, not in the tally. Posting puts it in the FYI note. **Absent = no proposal yet.**
- **`category`** = the kebab slug of the angle, ONLY one of nine: `correctness`, `security`, `reuse`, `simplification`, `efficiency`, `altitude`, `conventions`, `architecture`, `spec`. Invent no others.
- **`severity_class`** = the class code from the taxonomy in force; **`severity_gate`** = the code of the gate that cut the severity below the class level, otherwise `null` ([severity](../gates/severity.md#class-code)). Adopted threads have neither.
- **`mrComment`** exists on every finding that passed the verify gates; [comment texts](../steps/07-comments.md) write it.
- **`summary`** is in the comment language ([comment texts](../steps/07-comments.md)), code identifiers as they are.
