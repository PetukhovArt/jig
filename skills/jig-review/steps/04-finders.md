# Finders

## Partitions

`jig review-plan` ([prepare](01-prepare.md#layout)) prints the partitions and a finder per partition; spawn exactly what it prints. The rules below explain it, so you can tell when it is wrong for this diff and say so in the summary.

**Files are split, not angles.** The diff's files go into `N` partitions (`N = ceil(LINES / 150)`, at most 5; fewer only when the diff has fewer code files), and each finder gets one partition and **every selected angle**. A finder reads only its partition's diff parts; for behavior outside it, it relies on the [flow model](04-flow-model.md). When every finder carried a few angles over the whole diff, each re-read all of it and rediscovered the same flow: on a 10,263-line merge request seven finders grew 250-300k contexts over ~100 turns each.

**Coupled files stay together.** Code files that import each other and files in one directory land in one partition, within a balance cap (about 1.5 times the average partition): a store imported by every view does not pull the whole diff into one finder. A test joins the source it names or imports; a document joins the partition of its neighbours. A link imports do not show (a store read through a key, an event, a watcher, IPC, a request) crosses partitions as often as not: the flow model lists every such link under `Cross-partition links`.

**One finder per partition, unless the layout says otherwise.** `lean` and `solo`: one finder per partition on the deep tier, at the highest effort of its angles. `fanout`: a partition splits by its angles' tiers and efforts ([project config](../references/project-config.md), key `tiers`; defaults in [selector](../references/selector.md#tiers)), `p1-deep-high`, `p1-standard-high`, …, each reading the same partition. The config is applied literally: a token's tier is never raised to its neighbour's or lowered.

**Only the angles the [selector](../references/selector.md) chose run.** `deepening` is a separate agent with its own tier, outside the partitions ([selector](../references/selector.md#deepening)). A re-review range under 600 lines runs one finder, `rereview`, over the whole range as one partition ([re-review](09-rereview.md#round-rules)).

**The inline path: no finders.** At `N = 1`, and up to `N = 2` under the default layout `auto`, the session reviews the whole diff as one partition [inline](04-inline.md). This step covers the layouts with finders: `lean`, `fanout`, `solo`.

## Shared context

What every finder needs is read **once**, by you, before the first spawn. Tool output is paid in full by each agent that fetches it, on every later turn.

1. **The flow model.** Read the model file once ([check](04-flow-model.md#check)). It is the shared read set: what a finder needs outside its partition is in it, with `file:line`.
2. **The diff index, not the parts.** Each finder reads its own partition's parts; you read none of them before the spawn.
3. **Fresh, never a fork.** Every finder is spawned fresh with the brief below, on the model and effort the plan printed for it. A finder of a partition needs nothing of your conversation: the brief and the model file are its whole context. A fork inherits your effort: on !1935 the runner (deep/medium) forked the finders, they ran below the plan's deep/high and missed what the old run found.

## Spawn

Spawn every finder of the plan **in one batch**, in parallel, within the [subagent cap](../SKILL.md#rules-for-the-whole-run). Brief each with role `finder`: pass the path of its template, `<root>/skills/jig/references/roles/finder.md`, and let the subagent read it.

**Every call carries the model and effort of its tier explicitly**, not the session's model. Before spawning print the plan; it goes into the [cost line](08-output.md#output): `finders: p1 deep/high <deep model> · p2 deep/high <deep model> · …`.

**The brief order is fixed**: the shared prefix first, the personal tail last, so the shared part hits the prompt cache of the whole batch:
1. the diff index `jig review-plan` printed under `diff files:`;
2. the shared rules block ([project rules](02-rules.md)): only severity (verbatim) and skip rules;
3. the learnings block ([state](03-state.md#learnings));
4. the project root;
5. the focus note ([prepare](01-prepare.md#focus-note));
6. facts and decisions ([prepare](01-prepare.md#facts-and-decisions));
7. the flow model path ([flow model](04-flow-model.md));
8. the angle files and atoms: the absolute paths under `every finder reads:` (`read:`, `atoms:`), so the finder reads them without searching; under `fanout` they are printed per finder and move to its tail;
9. the spec file, when one was found ([prepare](01-prepare.md#spec));
10. the role template path;
11. **personal**: this finder's partition, its name and the part paths under its `diff:`. The parts are split by audience: `pN-code-*` always, `pN-tests-*` when angle 16 runs, `pN-docs-*` when angle 11 or 15 runs. A finder reads no part outside its `diff:` list; it may open another file by path to confirm a candidate;
12. **personal**: the documents under its `rules:` line ([routing](02-rules.md#4-routing)), narrowed by `route` to its angles, each with its scope ("this rule applies only under that directory").

Items 1–10 are byte-identical across the batch. Every document goes as a path, never pasted, except the severity sections and the skip rules of item 2.

**Run them in the foreground and save each report.** Several spawns in one message run in parallel, and each report returns to you; a background subagent may report to the session at the top instead of you, and outlives you when you fail. As each report arrives, with state on, write it to the [checkpoint](#checkpoint). Never `sleep` and never read a subagent's output file in a loop.

### Checkpoint

With state on, the run keeps its finished subagent reports in `<state file without .json>.run/`: one file per finder (`<finder name>.md`) and one for the deepener, each starting with the line `head: <reviewed HEAD sha> · diff: <the diff files folder name>`. A run that starts and finds this folder with its own head and diff is a retry: it reuses those reports and spawns only the finders that have none. Another head or diff: delete the folder and start clean. [Writing state](08-output.md#write-state) deletes it. A retry never repeats a finished finder: on one merge request a second runner restarted the whole fan-out and doubled its cost.

### Refused spawn

For every spawn of the run: finders, deepening, judges, composers.

The agent was refused because of the concurrent subagent limit: the refused one joins a **queue**: wait until one of your running subagents finishes and spawn it then. "Do not retry" is about an immediate retry; waiting for a slot is not one. The queue makes the run longer and keeps the coverage: every angle is read by its finder, every judge keeps its cluster within the verify limits.

None of your subagents is running and the spawn is still refused: the phase stops, `tally` gets `"degraded": "<reason>"` ([state](../references/state-schema.md)), and the run goes to [output](08-output.md) with what finished. Such a run moves neither `last_reviewed_sha` / `base_sha` / `diff_hash` nor `runs`: the next run rechecks the same range.

## What a finder returns

- up to 8 candidates per angle `{file, line, angle, root, summary, mechanism}`: past 8, mechanisms degrade into labels verify cannot judge. An angle marked "Candidate cap: none" (16, 17) returns all: its candidate is an instance of a mechanical rule, not a mechanism, and a cap silently cuts real findings;
- `root`: the symbol where the defect originates, not where it shows (the function that drops the source, not the `onClose` that calls it). [Dedup](05-verify.md#dedup) uses it to merge one chain that finders reported by different lines;
- angles 6, 10, 13 add `rule`: a verbatim quote of the rule, ADR or glossary entry; angle 15 adds [`spec_quote`](../angles/15.spec.md#spec_quote). No quote: the candidate is not returned;
- a section for **every** assigned angle, explicitly empty when it found nothing ("angle 2: nothing"). A missing section: ask the finder again. Skipping an angle silently is not allowed;
- **a candidate that spans partitions** (its cause or its effect sits in another partition's files): raised, anchored on its line in the finder's own partition, with `cross: L<n>`, the model link it travels, and the other side's `file:line`. The finder reads the other side only as far as the candidate needs; the judge, who holds the model, verifies it ([verify](05-verify.md#cross-partition-candidates)). A chain with no line in the finder's partition is not its candidate: that partition's finder owns it.

**Not returned**, because the judge would pay for a known verdict:
- a candidate the finder refuted itself with a quoted line. Doubt is not refutation: a doubtful one goes to verify;
- a contradiction of a recorded decision from the facts and decisions block. A wrong decision is a design conversation, not a thread;
- the evidence line exists in the base (`git show <base>:<file>`) and the diff did not touch the function it sits in. That is code from before the change; verify would not keep it ([pre-existing](../gates/severity.md#gates));
- a finding outside the assigned angles: another finder owns it and will report it.

Two angles on one line for different reasons: report both.

**The report did not arrive: ask for a resend, not for work.** The subagent finished and its report is not in the session (an environment defect, not the skill's): wake it with the literal request "send your report again, do no new work". A wake-up without that clause restarts the search and costs a second run.

## Layout solo

Only when `jig review-plan` printed `layout: solo`. No judge subagent follows: each finder proves its own candidates. Its brief gets, after item 12, the gate file paths of its angle classes (`<skill>/gates/bugs.md` for bug angles, `<skill>/gates/shape.md` for the rest, `<skill>/gates/severity.md` always) and this instruction: "Before returning a candidate, judge it by these gate files: try to reproduce it (by tracing the code, or a one-off script outside the repository; no test, no build, no install, no edits to the repository), then return a verdict per candidate in the verifier's fields: verdict, severity, `severity_class`, `severity_gate`, `blocks`, angle, category, a one-sentence summary with the evidence. A `CONFIRMED` bug names initiator, path and effect, each with a quote." A finder still reads only.

**No quota, either way.** Zero findings is a successful review: budgets are ceilings, there is no floor. But the rule binds reporting, not hunting: a finder hunts at full aggression, a candidate costs nothing and dies at verify. No hunk is skipped, no reading cut short, no candidate held back because "that is enough".
