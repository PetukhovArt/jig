# Finders

## Partitions and kinds

`jig review-plan` ([prepare](01-prepare.md#layout)) prints the partitions and the finders of each; spawn exactly what it prints. The rules below explain it, so you can tell when it is wrong for this diff and say so in the summary.

**Files are split, then the kind of work.** The diff's files go into `N` partitions (`N = ceil(LINES / 150)`, at most 5, at least 1; fewer only when the diff has fewer code files), or into the groups the runner made by the project's partition policy ([prepare](01-prepare.md#partition-policy)). Every partition gets one or two finders, the same for every diff size:

- **`behavior`** (`pN-behavior`): angles 1–5, 8, 12, 14, 15 and the project angles of kind `behavior`: bugs, state, wire contracts, efficiency and leaks, the spec. Deep tier, high effort. It traces a link out of its partition into the code on the other side itself.
- **`conventions`** (`pN-conventions`): only when the project adds angles of kind `conventions`, and only those. Standard tier, high effort. It reads the indexes, standards and glossaries under its `rules:` line.

Each reads only its kind's angle files and atoms, printed once per kind (`behavior finders … read:`, `conventions finders … read:`). A finder reads only its partition's diff parts; behavior outside it, it reads in the code, changed or not.

**Coupled files stay together.** With a partition policy, the policy decides that. Without one, code files that import each other and files in one directory land in one partition, within a balance cap (about 1.5 times the average partition): a store imported by every view does not pull the whole diff into one finder. A test joins the source it names or imports; a document joins the partition of its neighbours. A link imports do not show (a store read through a key, an event, a watcher, IPC, a request) crosses partitions as often as not: the finder on either end searches for the other end and reads it, and names the link in `cross:` ([what a finder returns](#what-a-finder-returns)).

**The grades come from the plan.** Defaults: `behavior` deep/high, `conventions` standard/high; the project config overrides them by these two keys ([project config](../references/project-config.md), key `tiers`). The plan's grade wins over the role template's frontmatter.

**Only the angles the [selector](../references/selector.md) chose run**; a finder left without angles is not spawned. The project config turns any angle off and adds its own angles to a kind ([project config](../references/project-config.md)): a project angle shows in the finder line by its name and its file under its kind's `read:`. `deepening` is a separate agent with its own tier, outside the partitions ([selector](../references/selector.md#deepening)). A re-review range under 600 lines is one partition with its finders ([re-review](09-rereview.md#round-rules)).

## Shared context

What every finder needs is read **once**, by you, before the first spawn. Tool output is paid in full by each agent that fetches it, on every later turn.

1. **The diff index, not the parts.** Each finder reads its own partition's parts; you read none of them before the spawn.
2. **Fresh, never a fork.** Every finder is spawned fresh with the brief below, on the model and effort the plan printed for it. A finder of a partition needs nothing of your conversation: the brief is its whole context. A fork inherits your effort: on a large merge request the runner (deep/medium) forked the finders, they ran below the plan's deep/high and missed what the old run found.

## Spawn

Spawn every finder of the plan **in one batch**, in parallel, within the [subagent cap](../SKILL.md#rules-for-the-whole-run); past the cap the rest [queue](#refused-spawn). Brief each with role `finder`: pass the path of its template, `<root>/skills/jig/references/roles/finder.md`, and let the subagent read it.

**Every call carries the model and effort the plan printed for that finder**, not the session's model. Before spawning print the plan; it goes into the [cost line](08-output.md#output): `finders: p1-behavior deep/high <deep model> · p2-behavior deep/high <deep model> · …`.

**The brief order is fixed**: the shared prefix first, the personal tail last, so the shared part hits the prompt cache of the batch:
1. the diff index `jig review-plan` printed under `diff files:`;
2. the shared rules block ([project rules](02-rules.md)): only severity and skip rules. The project's severity sections verbatim; no project section: the path `<skill>/gates/severity.md` instead;
3. the learnings block ([state](03-state.md#learnings));
4. the project root;
5. the focus note ([prepare](01-prepare.md#focus-note));
6. facts and decisions ([prepare](01-prepare.md#facts-and-decisions));
7. the role template path, and the partition policy verbatim when the plan printed `partition policy:`, with the line "your partition was grouped by this policy; links into the other partitions you trace yourself";
8. **per kind**: the finder's kind and the angle files and atoms printed under its kind (`read:`, `atoms:`), so the finder reads them without searching; `behavior` also gets the spec file when one was found ([prepare](01-prepare.md#spec));
9. **personal**: this finder's partition, its name and the part paths under its `diff:`. The parts are split by audience: `pN-code-*` always, `pN-docs-*` when angle 15 runs; nobody reads `pN-tests-*`. A finder reads no part outside its `diff:` list; it may open another file by path to confirm a candidate;
10. **personal**, `conventions` only: the documents under its `rules:` line ([routing](02-rules.md#4-routing)), narrowed by `route` to its angles, each with its scope ("this rule applies only under that directory").

Items 1–7 are byte-identical across the batch, item 8 within a kind. Every document goes as a path, never pasted, except the severity sections and the skip rules of item 2.

**Run them in the foreground and save each report.** Several spawns in one message run in parallel, and each report returns to you; a background subagent may report to the session at the top instead of you, and outlives you when you fail. As each report arrives, with state on, write it to the [checkpoint](#checkpoint). Never `sleep` and never read a subagent's output file in a loop.

### Checkpoint

With state on, the run keeps its finished subagent reports in `<state file without .json>.run/`: one file per finder (`<finder name>.md`) and one for the deepener, each starting with the line `run: <id> · head: <reviewed HEAD sha>`. A runner told to go on with its run (`retry:`) and finding reports with its own run id reuses them and spawns only the finders that have none. Any other run id: delete the folder and start clean; a new plan is a new run. [Writing state](08-output.md#write-state) deletes it. A retry never repeats a finished finder: on one merge request a second runner restarted the whole fan-out and doubled its cost.

### Refused spawn

For every spawn of the run: finders, deepening, judges, composers.

The agent was refused because of the concurrent subagent limit: the refused one joins a **queue**: wait until one of your running subagents finishes and spawn it then. "Do not retry" is about an immediate retry; waiting for a slot is not one. The queue makes the run longer and keeps the coverage: every angle is read by its finder, every judge keeps its cluster within the verify limits.

None of your subagents is running and the spawn is still refused: the phase stops, `tally` gets `"degraded": "<reason>"` ([state](../references/state-schema.md)), and the run goes to [output](08-output.md) with what finished. Such a run moves neither `last_reviewed_sha` / `base_sha` / `diff_hash` nor `runs`: the next run rechecks the same range.

## What a finder returns

- up to 8 candidates per angle `{file, line, angle, root, summary, mechanism}`: past 8, mechanisms degrade into labels verify cannot judge;
- `root`: the symbol where the defect originates, not where it shows (the function that drops the source, not the `onClose` that calls it). [Dedup](05-verify.md#dedup) uses it to merge one chain that finders reported by different lines;
- a project angle of kind `conventions` adds `rule`: a verbatim quote of the rule or glossary entry; angle 15 adds [`spec_quote`](../angles/15.spec.md#spec_quote). No quote: the candidate is not returned;
- a section for **every** assigned angle, explicitly empty when it found nothing ("angle 2: nothing"). A missing section: ask the finder again. Skipping an angle silently is not allowed;
- **a candidate that spans partitions** (its cause or its effect sits in another partition's files): raised, anchored on its line in the finder's own partition, with `cross:` the link it travels (import, store key, event, IPC, request) and the other side's `file:line`. The finder reads the other side as far as the candidate needs; the judge verifies it ([verify](05-verify.md#cross-partition-candidates)). A chain with no line in the finder's partition is not its candidate: that partition's finder owns it.

**Not returned**, because the judge would pay for a known verdict:
- a candidate the finder refuted itself with a quoted line. Doubt is not refutation: a doubtful one goes to verify;
- a contradiction of a recorded decision from the facts and decisions block. A wrong decision is a design conversation, not a thread;
- the evidence line exists in the base (`git show <base>:<file>`) and the diff did not touch the function it sits in. That is code from before the change; verify would not keep it ([pre-existing](../gates/severity.md#gates));
- a finding outside the assigned angles: another finder owns it and will report it.

Two angles on one line for different reasons: report both.

**The report did not arrive: ask for a resend, not for work.** The subagent finished and its report is not in the session (an environment defect, not the skill's): wake it with the literal request "send your report again, do no new work". A wake-up without that clause restarts the search and costs a second run.

## Layout solo

Only when `jig review-plan` printed `layout: solo`. No judge subagent follows: each finder proves its own candidates. Its brief gets, after item 10, the gate file paths of its angle classes (`<skill>/gates/bugs.md` for bug angles, `<skill>/gates/shape.md` for the rest, `<skill>/gates/severity.md` always) and this instruction: "Before returning a candidate, judge it by these gate files: try to reproduce it (by tracing the code, or a one-off script outside the repository; no test, no build, no install, no edits to the repository), then return a verdict per candidate in the verifier's fields: verdict, severity, `severity_class`, `severity_gate`, angle, category, a one-sentence summary with the evidence. A `CONFIRMED` bug names initiator, path and effect, each with a quote, and the steps a tester would take to meet it." A finder still reads only.

**No quota, either way.** Zero findings is a successful review: budgets are ceilings, there is no floor. But the rule binds reporting, not hunting: a finder hunts at full aggression, a candidate costs nothing and dies at verify. No hunk is skipped, no reading cut short, no candidate held back because "that is enough".
