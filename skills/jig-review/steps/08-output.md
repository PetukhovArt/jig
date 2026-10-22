# State and output

Mode `review` with state on: [write state](#write-state), then the [output](#output). Mode `review` without state (no merge request, or `--no-state`): only the [output](#output). Mode `pre-mr`: no state, the [pre-mr verdict](#pre-mr-verdict) instead.

## Write state

Only with state on (`jig review-plan` printed `state: on`). Write into the state file:

- new findings with `status: "open"` **and the `mrComment` written by [comment texts](07-comments.md)**, verbatim, as it will be posted. A printed finding with only `summary` in state is a lost comment: posting has nothing to post;
- simplifications ([shape gate](../gates/shape.md#shape-gate)) with `status: "optional"` and a one-sentence `mrComment`. Earlier `optional` ones stay: the note is built from all of them;
- `deepening`: the proposal of this run, when the deepener returned one, replacing an earlier one ([schema](../references/state-schema.md)). A run without a proposal leaves the earlier one;
- outcome statuses from [re-review](09-rereview.md). Thread replies are not written to state; they have their own channel: item 5 of the output;
- `last_reviewed_sha` = the reviewed HEAD sha;
- `base_sha` = `git rev-parse <base>`: the base of THIS run resolved to a sha. Written in the same write as `last_reviewed_sha` and `diff_hash`: the triple describes one patch, and [scope recovery after a force-push](09-rereview.md#scope-after-a-force-push) reads it whole. `<base>` is a moving ref; its name is useless to the next run;
- `diff_hash` = `git diff <base>...HEAD | git hash-object --stdin` on the reviewed diff. Without it [re-review](09-rereview.md) cannot tell a rebase from new work and runs in full every time;
- `runs` += 1;
- `tally`: this run's counters;
- `timings`: start, finish, seconds per phase from the [clock](03-state.md#state) stamps;
- `tokens`: subagent token sums per phase. This run's numbers replace the earlier ones.

Then delete the run's [checkpoint](04-finders.md#checkpoint) folder: the state now holds what it kept. A run that does not publish its tally (convergence check failed, degraded) keeps it for the retry.

Field rules (allowed `category` slugs and the rest): [`../references/state-schema.md`](../references/state-schema.md).

**Convergence check (re-review).** Every finding that entered the outcome check leaves with a status:

```
prior_fixed + prior_skipped + prior_unverified + prior_no_change_needed == entered
```

Entered = every finding with an open thread: status not `fixed`, not `no_change_needed`, not `optional` (a simplification has no thread). The rule holds on the [short path](09-rereview.md#re-review) too, where the diff did not change and nothing was rechecked: each such finding enters `prior_*` with its carried status; zeros there are a hole. A consumer that counts open threads compares this sum with its own count: `jig review-cycle reconcile` counts the standing findings of the state as it was before the run and blocks the merge request when the sum is short.

It does not add up: the run lost findings. Say so, name the ones without a status, **do not move `last_reviewed_sha` / `base_sha` / `diff_hash`** and do not increment `runs`: the next run rechecks the same range instead of inheriting the hole. A tally that does not add up is not published.

## Output

Mode `review`. Always printed, in this order.

0. **Degraded line, only with `tally.degraded`** ([refused spawn](04-finders.md#refused-spawn)): `degraded: <reason>; coverage below normal`. First, before the tally. Not degraded: no line at all.
1. **Tally line:** `2 Important, 1 Nit · optional: 3 · prior: 3 fixed, 1 skipped, 1 unverified · suppressed: 4 nit, 3 under rework, 2 rare · spec: 2 findings`.
   With `suppressed_rare`, then the line `known risks: <file> · <defect>; …` ([rare gate](../gates/bugs.md#rare-gate)).
   **The `spec` tail is always printed**, in one of three forms: `spec: N findings` ([angle 15](../angles/15.spec.md) ran and found something), `spec: matches` (ran and found nothing), `spec: not found` (did not run, with the reason when a named task could not be read). Without it a matching spec is indistinguishable from an unchecked one. The first two end with the source and the file the finder read ([prepare](01-prepare.md#spec)): `spec: 2 findings (PROJ-46 · <path>)`.
   A learnings file exists: the line ends with `· learnings: N active`.
2. **Cost line:** `agents: 5 finders + 4 verify + 1 composer · 0.9M tokens · 4m12s (finders 1m50s, verify 1m30s)` (inline: `agents: inline + 1 verify`), then the finder plan with tiers and models, then `judge: <finder model> → <judge model>` pairs, then `· rules: <path>` or `rules: not found`, then `· selector: <tokens>` or `selector: full` (for `auto` with the expansion: `auto → important,tests`).
3. **Machine line** on its own line; consumers (a review cycle, CI gates) parse it and do not read the prose:

```json
{"important":2,"nit":1,"optional":3,"pre_existing":0,"suppressed_nits":4,"suppressed_speculative":0,"suppressed_rare":0,"suppressed_selector":0,"suppressed_blocked":3,"suppressed_stale":0,"spec":2,"prior_fixed":3,"prior_skipped":1,"prior_unverified":1,"prior_no_change_needed":0}
```

   `spec` = the number of angle 15 findings, `null` when no spec was found. `0` and `null` are not interchangeable: the first means "checked, matches", the second "not checked". `degraded` enters the machine line only for a degraded run, with the same reason string as in state.

4. **Every survivor in full:** `file:line` plus `mrComment` verbatim, suggestion blocks included. The printed set is exactly what will be posted. Without state there are no comment texts: `file:line`, severity, the judge's `summary` with its evidence, and the fix direction in one sentence.
   With `optional`: after the findings a section `## Improvements (optional, not blocking the merge)`: a checklist `- [ ] <file:line> — <mrComment>`, `- [x]` for an item `done` in state. The same text goes as one unresolvable note on the merge request, not as threads ([posting](../references/posting.md)).
   With `deepening`: after the findings a section `## Deepening`: one item `module · what to deepen · effect · blast radius`. Not a finding: no thread and no tally; with state on it is in state as `deepening`, and posting puts it in the FYI note ([selector](../references/selector.md#deepening)).
5. Re-review: **one line per outcome** `<id> → <status>`, and the thread reply texts in full, each with its `discussion_id` (counter-replies, [replies to a developer's reply](09-rereview.md#reply-to-every-reply) and to [a commit that left an Important standing](09-rereview.md#an-important-that-stands-after-a-new-commit)), then the FYI answer apart, with the FYI note's `discussion_id`, and one line per rechecked [optional item](09-rereview.md#optional-items) `<id> → done | not done`. This is the only channel for replies: posting sends them from here; state does not hold them. The evidence of outcomes is not printed here: it exists to discipline the outcome subagent, and that burden lives on its return. Print the evidence of one outcome on explicit request.
6. A learning added in this run: print it and the proposed line for the project's review document. A finding that repeats across merge requests: propose the check that would stop it (atom `lessons-to-checks`).
7. Nothing found: one line saying so; the machine line is printed anyway.
8. **Refuted, for the operator only.** The last section `## Refuted (not posted)`: one line per candidate refuted in this run, `file:line · angle N · reason`. The reason is one phrase from the judge's `summary`, with the proving line when it is short. The section goes into neither state, tally, posting nor replies. It shows the operator what the gates cut, so they can bring a finding back by hand when the bar was stricter than needed. Nothing refuted: no section.

Do not send findings to a structured panel of the agent's interface where one exists: the printed output is the result.

Post nowhere until asked: [posting](../references/posting.md).

## Pre-mr verdict

Mode `pre-mr`. You are the lead reviewer of your own change, a pragmatic senior engineer, not a neutral aggregator. Put every candidate that reached verify into exactly one of four buckets, each with the models that raised it, the judge's model and a one-line rationale:

- **Act on**: `CONFIRMED` `Important`: correctness, security, data loss, a leak, a structure the next code builds on, a missed or contradicted spec requirement. It would block a real merge request. **You fix these now**, before the merge request.
- **Consider**: `CONFIRMED` `Nit` and `Pre-existing`, a spec item done without being asked, and the deepening proposal: legitimate, but whether it is worth the cost now is the user's call. **Ask the user** per item, with your recommendation; do not fix them unasked.
- **Noted**: technically valid, not actionable now: simplifications (`optional`), known risks from the [rare gate](../gates/bugs.md#rare-gate), the counts muted by the selector or by a rework. A brief list.
- **Dismissed**: everything `REFUTED`, with the judge's reason in one phrase.

Signals for the buckets, beyond the verdict:

- **Two models**: a candidate raised by finders on different models, or confirmed by a judge on another model than the finder's, is the highest signal. Note it on the item.
- **Nitpick gravity**: finders hunt at full aggression and fill their sections. When every confirmed item is a Nit, the change is probably fine; say so.
- **"I would have done it differently"** without a concrete problem is Dismissed, not Consider.
- **Missing context**: an item about code the diff did not touch, or a pattern consistent with the rest of the codebase, is Dismissed with that reason.
- Do not dismiss a security or correctness item only because it is uncomfortable: it deserves more scrutiny even from one model.

Print, in this order:

```
### Intent
> <one paragraph: what the change is for, from the task, the commits and the code>

### Reviewers
- finder <name>: angles <list>, <tier/effort> <model>, <N> candidates   (inline: `inline: angles <list>, <your model>, <N> candidates`)
- judges: <finder model> → <judge model>, <M> clusters   (inline: `judge: <model>, <K> Important candidates` or `judge: inline only`)

### Act on
- `file:line` · <defect and failure scenario> · raised by <models> · judged by <model>

### Consider
- `file:line` · <finding> · <the trade-off> · recommendation: <fix now | later | no>

### Noted
- <item>

### Dismissed
- `file:line` · <reason>

### Agreement map
<where models agreed and diverged, and what the pattern says>
```

Then one machine line for the calling flow: `{"act_on":N,"consider":N,"noted":N,"dismissed":N}`.

**After the verdict:** fix every Act on item, then run the project's checks on the fixes. **No second review after the fixes**: the review judged the change, the checks prove the fixes. A fix that turns out wider than its finding (a module moves, a contract changes) is new work: say so to the user instead of fixing silently. Consider items wait for the user's answer; the calling flow continues with cleanup and the merge request.
