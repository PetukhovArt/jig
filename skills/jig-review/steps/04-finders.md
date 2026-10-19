# Finders

## Layout of angles over finders

`jig review-plan` ([prepare](01-prepare.md#layout)) prints the layout; spawn exactly what it prints. The rules below explain it, so you can tell when it is wrong for this diff and say so.

**Only the angles the [selector](../references/selector.md) chose are laid out.** A finder left without angles is not spawned. `deepening` is a separate agent with its own tier, outside the layout ([selector](../references/selector.md#deepening)).

Every finder gets **the whole diff**. The questions are split, not the files: the more readers, the fewer angles each carries and the deeper it goes into its own. The cost is the number of readers, not the number of angles: a finder with several angles reads the diff once.

**`N = 1`: one finder for everything.** Below this size a split does not pay: angles are spread over readers so attention does not dilute, and on such a diff there is nothing to dilute. The single finder takes the bug angles, cleanup (7, 9), rules (6, 10, 11, 13, 15) and 16, 17; rule documents and the spec go into its tail once. It runs on the strongest tier among its angles. The rules below about separate rules, cleanup and tests finders hold for `N > 1`.

**Rules 6, 10, 13, documents 11 and spec 15: one finder (`rules`) on top of `N`.** It reads the diff against the project's documents: the review document block, the smell vocabulary, the architecture document, the ADR table of contents and the owning glossary ([step 02](02-rules.md)) go into its personal tail; other finders do not get them. Angle 11 sits here, not in cleanup: it judges changed ADRs and glossaries, which this finder reads anyway.

**Tests and comments 16, 17: one finder (`mechanical`) on top of `N`**, only when the diff has tests or added comment lines. The criteria are mechanical and have no candidate cap: a separate finder keeps their stream away from the bug finders' attention.

**Cleanup 7, 9: one finder (`cleanup`).** These angles survive only as `CONFIRMED`; a second cleaner buys nothing.

**Spec 15 belongs to the rules finder**, only when a spec was found. A separate spec agent did not pay off: it read the whole diff for a four-line description and returned nothing.

**The other `N − 1` are bug finders (`bugs`).** The eight angles 1, 2, 3, 4, 5, 8, 12, 14 spread over them:

- 1 → `1+2+3+4+5+8+12+14`
- 2 → `1+4+8+14` · `2+3+5+12`
- 3 → `1+4+8+14` · `2+3` · `5+12`
- 4 → `1+4+8` · `14` · `2+3` · `5+12`

Pairs stay together while readers are short: 1, 4, 8 and 14 read lines (8 looks in them for extra work and retention, 14 for sinks), 2 and 3 start from removed code and call edges, 5 and 12 look for the same thing in different places. **1 and 4 never split:** language traps are seen by the same line-by-line reading; a separate angle-4 finder returned only duplicates of angle 1.

**An angle belongs to exactly one finder.** Two readers of one question on one diff return one finding twice, not twice the findings.

**One finder, one tier.** An angle's tier and effort come from its token ([project config](../references/project-config.md), key `tiers`; defaults in [selector](../references/selector.md#tiers)). A finder whose angles have different tiers splits: one finder per tier and effort, each with its own angles and its own documents in the tail. This is the last step of the layout, after the bug split (`N = 1` keeps its single finder). With `1+4+8+14`, where `bugs` is deep/high and `efficiency`, `security` are standard/high, the spawn is `1+4` and `8+14`. The config is applied literally: a token's tier is never raised to its neighbour's or lowered.

## Spawn

Spawn every finder of the layout **in one batch**, in parallel, within the [subagent cap](../SKILL.md#rules-for-the-whole-run). Brief each with role `finder`: pass the path of its template, `<root>/skills/jig/references/roles/finder.md`, and let the subagent read it.

**Every call carries the model and effort of its tier explicitly**, not the session's model. Before spawning print the plan; it goes into the [cost line](08-output.md#output): `finders: 1+4 deep/high opus · 8+14 standard/high sonnet · 2+3+5+12 deep/high opus · …`.

**The brief order is fixed**: the shared prefix first, the personal tail last, so the shared part hits the prompt cache of the whole batch:
1. the diff (or the command that prints it, when it is large);
2. the shared rules block ([project rules](02-rules.md)): only severity (verbatim) and skip rules; convention bodies go to the rules finder;
3. the learnings block ([state](03-state.md#learnings));
4. the project root;
5. the focus note ([prepare](01-prepare.md#focus-note));
6. facts and decisions ([prepare](01-prepare.md#facts-and-decisions));
7. this finder's angles: the paths of their files under `<skill>/angles/`;
8. the documents routed to its angles by `route`, each with its scope ("this rule applies only under that directory");
9. the role template path.

Items 1–6 are identical across the batch. Items 7–9 are personal: a document addressed to angle 13 never reaches the finder that reads lines.

### Refused spawn

For every spawn of the run: finders, deepening, judges, composers.

The agent was refused because of the concurrent subagent limit: the refused one joins a **queue**: wait until one of your running subagents finishes and spawn it then. "Do not retry" is about an immediate retry; waiting for a slot is not one. The queue makes the run longer and keeps the coverage: every angle is read by its finder, every judge keeps its cluster within the verify limits.

None of your subagents is running and the spawn is still refused: the phase stops, `tally` gets `"degraded": "<reason>"` ([state](../references/state-schema.md)), and the run goes to [output](08-output.md) with what finished. Such a run moves neither `last_reviewed_sha` / `base_sha` / `diff_hash` nor `runs`: the next run rechecks the same range.

## What a finder returns

- up to 8 candidates per angle `{file, line, angle, root, summary, mechanism}`: past 8, mechanisms degrade into labels verify cannot judge. An angle marked "Candidate cap: none" (16, 17) returns all: its candidate is an instance of a mechanical rule, not a mechanism, and a cap silently cuts real findings;
- `root`: the symbol where the defect originates, not where it shows (the function that drops the source, not the `onClose` that calls it). [Dedup](05-verify.md#dedup) uses it to merge one chain that finders reported by different lines;
- angles 6, 10, 13 add `rule`: a verbatim quote of the rule, ADR or glossary entry; angle 15 adds [`spec_quote`](../angles/15.spec.md#spec_quote). No quote: the candidate is not returned;
- a section for **every** assigned angle, explicitly empty when it found nothing ("angle 2: nothing"). A missing section: ask the finder again. Skipping an angle silently is not allowed.

**Not returned**, because the judge would pay for a known verdict:
- a candidate the finder refuted itself with a quoted line. Doubt is not refutation: a doubtful one goes to verify;
- a contradiction of a recorded decision from the facts and decisions block. A wrong decision is a design conversation, not a thread;
- the evidence line exists in the base (`git show <base>:<file>`) and the diff did not touch the function it sits in. That is code from before the change; verify would not keep it ([pre-existing](05-verify.md#gates));
- a finding outside the assigned angles: another finder owns it and will report it.

Two angles on one line for different reasons: report both.

**The report did not arrive: ask for a resend, not for work.** The subagent finished and its report is not in the session (an environment defect, not the skill's): wake it with the literal request "send your report again, do no new work". A wake-up without that clause restarts the search and costs a second run.

**No quota, either way.** Zero findings is a successful review: budgets are ceilings, there is no floor. But the rule binds reporting, not hunting: a finder hunts at full aggression, a candidate costs nothing and dies at verify. No hunk is skipped, no reading cut short, no candidate held back because "that is enough".
