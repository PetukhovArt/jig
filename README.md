<div align="center">

# jig

**A harness plugin for AI coding agents: code checks what code can check, the model keeps the rest.**<br/>
The agent cannot end a turn on a type error, and cannot open a merge request with an unproven UI change.

[![CI](https://github.com/PetukhovArt/jig/actions/workflows/ci.yml/badge.svg)](https://github.com/PetukhovArt/jig/actions/workflows/ci.yml) [![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE) [![node](https://img.shields.io/badge/node-%3E%3D20-339933.svg)](package.json) [![Claude Code plugin](https://img.shields.io/badge/Claude_Code-plugin-D97757.svg)](.claude-plugin/plugin.json)

</div>

## Why jig

- **Gates before the edit lands.** A new lint or type suppression is always denied. A new comment or test case is denied once, with the rules to judge it by.
- **Every turn ends green.** tsc, ESLint, stratum and the project's own checks run over the session's own files at the end of each turn and block it on an error. A parallel session in the same checkout does not trip your gate.
- **UI proven on the running app.** `jig pre-mr` holds the merge request until each changed UI file has a replayed use case and a screenshot, or a recorded reason why not.
- **Review with a second model.** `jig-review` sizes its finders by the diff, and a judge on another model proves each finding before the author sees it. `jig-review-cycle` does it for every merge request waiting on you.
- **Fits a legacy codebase.** Lint errors count on changed lines only, type errors in the turn's files only, stratum starts from a baseline: the agent answers for what it touched, not for the history.
- **Never stuck, never slow.** Three blocks in a row and the gate steps aside with a journal record instead of looping. Budgets of 300 ms at p95 per edit hook and 20 s for the end-of-turn gate on 20 files are checked by the [benchmarks](docs/evals.md#benchmarks).
- **Parallel by default.** A worktree per task, slots with offset dev and CDP ports, a gate scoped to its own session, one heavy check at a time across sessions.
- **Unattended, yet auditable.** `afk-mode` works toward a checkable done condition and logs every decision; a separate auditor checks the log against `git log` before you read it.
- **Learns from its own misses.** Every deny, block and failure lands in a journal; the weekly loop turns repeats into proposed checks and rules, and you approve each one.
- **Measured, not believed.** Agent evals run the same tasks with and without the plugin; a change to an atom or flow goes through the [`eval`](skills/jig/flows/eval.md) flow before it stays.
- **The right model per job.** Each subagent role names a tier and an effort: cheap models prune comments and post threads, deep ones judge findings and designs.
- **Thin on top, light underneath.** Knowledge lives in short atoms read when their trigger applies; flows run only when you type `/jig`. One CLI, Node >= 20, no runtime dependencies; in your project it writes only `.jig/`.

## Who it is for

jig is agnostic by design: the core knows events, files and checks, not an agent, a language or a framework. It is built **Claude Code first, TypeScript first, frontend first**, and is strongest on four fronts:

- **Deterministic checks.** What code can decide, code decides: gates in hooks, the review layout from `jig review-plan`, the merge request gate from `jig pre-mr`, the queue from `jig review-cycle`. Same input, same verdict; the model judges only what no tool can.
- **Architecture.** Module layers and boundaries checked on every edit ([stratum](https://github.com/PetukhovArt/stratum)), atoms on module depth, domain models and system edges, a flow that sketches two designs before writing one.
- **Verification.** Type and lint gates every turn, UI proof on the running app ([agent-view](https://github.com/PetukhovArt/agent-view): browser, Electron, Tauri), a review whose findings a second model proves.
- **Extensibility.** Any language joins through the project's own `checks`; agents join through an adapter, a team's review process through a [process adapter](docs/review-cycle.md#process-adapter).

| | ready today | through extension |
| --- | --- | --- |
| agent | Claude Code | Cursor, Codex: an adapter over the same events ([agents](docs/agents.md)) |
| language | TypeScript, JavaScript, Vue; C# in the comment, test and suppression gates | any: a `checks` entry with `{files}` ([configuration](docs/configuration.md)) |
| project | web, Electron and Tauri apps, monorepos | backends, CLIs, libraries: everything but UI proof |
| platform | Windows, macOS, Linux; GitLab and GitHub | |

## Quick start

In Claude Code 2.1.275 or later:

```text
/plugin install jig --marketplace PetukhovArt/jig
/jig-init
/jig <task>
```

`/jig-init` discovers your tools, asks only what code cannot know, writes `.jig/config.jsonc` and runs `jig doctor`.

<details><summary><b>Install from a shell</b></summary>

```text
claude plugin marketplace add PetukhovArt/jig
claude plugin install jig@petukhovart
```

Then run `/jig-init` in your project, or `node <plugin root>/bin/jig.mjs doctor` to see the config, each catalog tool and anything missing.

</details>

## Usage

The hooks need nothing from you: once `.jig/config.jsonc` names the tools, every edit and every turn goes through them ([hooks and gates](docs/hooks.md)).

### Just use [`/jig`](skills/jig/SKILL.md)

The one skill to remember. Start a task that needs rigor with it, and say how you will know it is done:

```text
/jig the camera list flickers when a filter changes. reproduce it first, then fix and prove it in the app.
```

```text
/jig i'm going to bed. move every caller of the sync store to the async one, behavior unchanged.
```

It restates the task with a done check, picks one of its flows and copies the flow's steps into the todo list. Every code-changing flow ends with the shared [`mr`](skills/jig/flows/mr.md) step: review your own diff, prove the UI, `jig pre-mr`, then the merge request.

<!-- flows:start -->

<details><summary><b>All 17 flows</b></summary>

| flow | for |
| --- | --- |
| [afk-mode](skills/jig/flows/afk-mode.md) | work unattended toward a checkable done condition, or turn a queue of tasks into a stack of merge requests the human lands. |
| [bug-bash](skills/jig/flows/bug-bash.md) | attack a feature in the running app and report reproduced bugs. |
| [bug-fix](skills/jig/flows/bug-fix.md) | reproduce, find the root cause, fix, prove. |
| [custom-flow](skills/jig/flows/custom-flow.md) | no flow fits, or the work is large and cross-cutting: frame it, design its workflow, run each unit as an experiment, leave a decision trail. |
| [diagnose](skills/jig/flows/diagnose.md) | find the cause of a symptom without fixing it, from a live process or a captured artifact; the fix is bug-fix. |
| [eval](skills/jig/flows/eval.md) | measure how a change to an atom, flow or skill changes agent behavior before you keep it. |
| [feature](skills/jig/flows/feature.md) | build new behavior with the right data shape and prove it on the running product. |
| [investigation](skills/jig/flows/investigation.md) | understand code or a decision without changing it. |
| [metric-climb](skills/jig/flows/metric-climb.md) | improve one metric over many measured attempts until a stop predicate holds; a one-off slowness fix is perf. |
| [module-design](skills/jig/flows/module-design.md) | ground, sketch two shapes in parallel, pick by depth, implement against the sketch. |
| [mr-watching](skills/jig/flows/mr-watching.md) | drive your open merge requests through conflicts, threads and CI, and land a verified stack when the user says so. |
| [perf](skills/jig/flows/perf.md) | measure, explain the limiter, fix, measure again. |
| [prototype](skills/jig/flows/prototype.md) | settle a design decision with a throwaway instrument. |
| [refactoring](skills/jig/flows/refactoring.md) | change structure, keep behavior, prove equivalence. |
| [session-pause](skills/jig/flows/session-pause.md) | stop cleanly with a resume point. |
| [session-resume](skills/jig/flows/session-resume.md) | resume work a previous session left. |
| [ui-match](skills/jig/flows/ui-match.md) | make UI match a reference: a design (Figma, an image) or an existing implementation. |

</details>

<!-- flows:end -->

## Skills

[`/jig`](skills/jig/SKILL.md) reaches for the rest when a step needs them (`jig-review`, `jig-slots`, `jig-task-status`). Type one yourself when you want just that:

```text
/jig-review https://gitlab.example.com/team/app/-/merge_requests/412 --post
```

```text
/loop 2h /jig-review-cycle
```

Three skills the model may also start on its own, because a flow step or a schedule needs them; the rest run only when you type them ([why each](docs/flows.md#who-starts-a-skill)).

<!-- skills:start -->

<details><summary><b>All 10 skills</b></summary>

| skill | started by | what it does |
| --- | --- | --- |
| [`/jig`](skills/jig/SKILL.md) | you | Run a task through a jig flow: pick the flow, track its steps, prove the result. |
| [`/jig-explain`](skills/jig-explain/SKILL.md) | you | Explain the current topic visually: pseudocode, call trees, file trees, diagrams. |
| [`/jig-grill`](skills/jig-grill/SKILL.md) | you | Interview the user about a plan, a decision or an idea, walking its decision tree one question at a time until nothing is silently assumed. |
| [`/jig-init`](skills/jig-init/SKILL.md) | you | Set jig up for this project, or settle it after the project changed: discover tools by the jig catalog, ask the user only what code cannot know, write an explicit .jig/config.jsonc, set up agent-view and stratum with their own commands, then run jig doctor. |
| [`/jig-prune-comments`](skills/jig-prune-comments/SKILL.md) | you | Remove code comments the comments atom does not allow, across a merge request, a folder or the whole repository, with a swarm of cheap agents. |
| [`/jig-review`](skills/jig-review/SKILL.md) | you or the model | Review a diff with finders, a separate judge and proven findings. Mode review: someone else's merge request, threads, --post, re-review. Mode pre-mr: your own diff before the merge request, a verdict in four buckets. |
| [`/jig-review-cycle`](skills/jig-review-cycle/SKILL.md) | you or the model | Review every merge request awaiting your review in one pass: filter, review each in its own worktree with jig-review, post the threads, record the verdict through the team's process adapter. |
| [`/jig-slots`](skills/jig-slots/SKILL.md) | you or the model | Give a task its own git worktree, and show finished branches in a slot: a worktree with a warm dev server on offset dev and CDP ports. |
| [`/jig-task-status`](skills/jig-task-status/SKILL.md) | you | Keep a reviewable decision trail of a long or unattended run: one TSV row per decision, step or question, and an HTML page built from it on demand. |
| [`/jig-video`](skills/jig-video/SKILL.md) | you | Record a narrated demo video of a change's use cases by driving the running app. |

</details>

<!-- skills:end -->

## Key ideas

**A pyramid of needs for the agent.** As in Maslow's pyramid, the lower layers come first: an agent that can break the build gains nothing from a clever plan. The bottom three are durable and get the investment; the top three get thinner with every model release, so jig keeps them small ([more](docs/agents.md#the-harness-pyramid)).

```text
         evolution       journal, weekly loop                  ┐
       orchestration     /jig, flows, review, decision trail   │ thin: models absorb these
          context        atoms read on their trigger           ┘
       verification      gates, tsc, ESLint, stratum, UI proof ┐
          safety         deny suppressions, comments, tests    │ durable: invest here
         execution       worktrees, slots with a warm app      ┘
```

**Code checks what code can check.** A rule a tool can enforce is a hook, not a sentence in a prompt. The model cannot skip a gate, argue with it or forget it after compaction: suppressions are denied before the edit, and the turn does not end on a type error ([hooks and gates](docs/hooks.md)).

**Proof on the running product.** Green tests do not prove a UI change. [agent-view](https://github.com/PetukhovArt/agent-view) drives the app as its user does: a replayed use case proves the behavior, a screenshot proves the look, and `jig pre-mr` holds the merge request until both exist ([UI proof](docs/ui-proof.md)).

**Architecture as a checked rule.** [stratum](https://github.com/PetukhovArt/stratum) checks module layers and boundaries from a config on every edit, fast enough for the hot path. A legacy codebase starts from a baseline: only new violations block.

**A finding is proven, not claimed.** Review finders hunt aggressively; a judge on a different model keeps only what it can prove on a quoted line. Every claim in a reply carries its evidence.

**Thin knowledge, read on its trigger.** No long system prompt: each rule is a short atom with a one-line trigger, read only when the work matches it.

## Atoms and roles

Atoms are the rules behind the key ideas, one per file, indexed in [`skills/jig/SKILL.md`](skills/jig/SKILL.md) by the moment of work. Roles are subagent templates the flows spawn, each with a model tier and an effort ([more](docs/flows.md)).

<!-- atoms:start -->

<details><summary><b>All 28 atoms</b></summary>

| atom | group | apply |
| --- | --- | --- |
| [automate-repeats](atoms/automate-repeats.md) | process | to any non-trivial edit, migration, analysis or check |
| [autonomy](atoms/autonomy.md) | process | when you are about to ask the human 'should I do X?' or to stop and wait |
| [context-window](atoms/context-window.md) | process | when context fills up: large outputs, long files, repeated reads, fan-out work |
| [lessons-to-checks](atoms/lessons-to-checks.md) | process | when you catch yourself writing the same instruction a second time, or see a recurring correction or review finding |
| [questions](atoms/questions.md) | process | before you ask the human anything, or when you interview them about a plan |
| [small-steps](atoms/small-steps.md) | process | to multistep work and to how you stack commits and merge requests |
| [writing-for-agents](atoms/writing-for-agents.md) | process | when you write or edit text an agent runs on: a skill, a flow, an atom, a role, AGENTS.md or CLAUDE.md |
| [design-it-twice](atoms/design-it-twice.md) | design | when facing a novel module interface, data shape or architectural decision with no precedent in the codebase, or when a new requirement lands in an existing design |
| [do-less](atoms/do-less.md) | design | when sizing a change, adding an option or abstraction, or sequencing an addition |
| [domain-model](atoms/domain-model.md) | design | when writing stateful logic, designing types, or when code branches a lot on the same shape |
| [module-depth](atoms/module-depth.md) | design | before you write code that crosses a function boundary: a new or changed signature, exported type or module surface |
| [one-way](atoms/one-way.md) | design | when introducing a new API, abstraction or way of doing a task while old ones exist |
| [patterns](atoms/patterns.md) | design | when designing a module interface with two or more variants, or when untangling complex code: a switch on type, an instanceof chain, duplicated conditional creation, an import cycle |
| [shared-state](atoms/shared-state.md) | design | when concurrent actors, modules or runs might write the same file, key, branch or state object, or when a command must survive crashes and retries |
| [system-edges](atoms/system-edges.md) | design | when wiring validation, error handling, adapters or imports across modules |
| [comments](atoms/comments.md) | code | when you add, keep or review a code comment |
| [dead-code](atoms/dead-code.md) | code | when deleting code believed unused, or reviewing a diff that leaves an export, file or branch nothing reaches |
| [docs](atoms/docs.md) | code | when writing, editing or reviewing a Markdown document (README, docs, ADR, glossary) |
| [effects](atoms/effects.md) | code | when writing or reviewing reactive code (Vue, React, Solid, signals, stores) |
| [tests](atoms/tests.md) | code | when you write, change, keep or review a test |
| [typescript](atoms/typescript.md) | code | when reading or editing TypeScript |
| [change-impact](atoms/change-impact.md) | proof | before you change code other code depends on |
| [evidence](atoms/evidence.md) | proof | to every claim in a reply or report |
| [prove-shippable](atoms/prove-shippable.md) | proof | after completing a task, before declaring done |
| [root-causes](atoms/root-causes.md) | proof | when debugging |
| [why-this-number](atoms/why-this-number.md) | proof | before you trust, report or act on a measured number: a speedup, a regression, a latency, a throughput, an eval score |
| [reader-cost](atoms/reader-cost.md) | review | when shaping or reviewing code that is hard to trace |
| [smells](atoms/smells.md) | review | when judging whether a hunk is a code smell |

</details>

<!-- atoms:end -->

<!-- roles:start -->

<details><summary><b>All 20 roles</b></summary>

| role | tier / effort | when |
| --- | --- | --- |
| [comment-pruner](skills/jig/references/roles/comment-pruner.md) | fast/low | Use in jig-prune-comments, one per batch of files, to delete comments the comments atom does not allow. Edits only inside one function; hands everything else back. |
| [composer](skills/jig/references/roles/composer.md) | standard/medium | Use in jig-review, one per architectural Important finding, to write its expanded thread text from the judge's evidence. Writes text only; the verdict is given. |
| [deepener](skills/jig/references/roles/deepener.md) | deep/high | Use in jig-review when the selector asks for deepening, to propose the one module deepening with the largest effect on the diff's new or changed modules. A proposal, not a finding. |
| [explainer](skills/jig/references/roles/explainer.md) | deep/medium | Use in investigation (How step) to merge the explorer maps into one explanation of how the code works. Spot-checks their file:line claims; synthesizer answers Why instead. |
| [explorer](skills/jig/references/roles/explorer.md) | standard/medium | Use in investigation (How step), 2 to 4 in parallel, to map one angle of the code with file:line. Read only, gathers without concluding; investigator searches history instead. |
| [finder](skills/jig/references/roles/finder.md) | standard/high | Use in jig-review, one per finder of the jig review-plan layout, to hunt candidates for its angles in a diff. Finds aggressively; the verifier judges later. |
| [fixer](skills/jig/references/roles/fixer.md) | standard/high | Use in mr-watching, one per merge request in its worktree, to fix, decline or defer each reviewer thread. Handles review threads only, not a general code fixer. |
| [investigator](skills/jig/references/roles/investigator.md) | deep/high | Use in investigation (Why step), one per evidence source, to find why code is the way it is in commits, merge requests or docs. Gathers dated evidence, not code maps. |
| [journal-auditor](skills/jig/references/roles/journal-auditor.md) | standard/medium | Use in afk-mode to audit an unattended run against git log and the diff. Lists decisions without evidence and unproven done claims, or says clean. |
| [module-sketcher](skills/jig/references/roles/module-sketcher.md) | deep/high | Use in the coliseum fan-out (module-design), several in parallel, to sketch one candidate module interface in its own location. Commits to one shape; referee compares. |
| [outcome-checker](skills/jig/references/roles/outcome-checker.md) | deep/medium | Use in jig-review on a re-review with no developer replies, to give every earlier open finding exactly one status against the current tree. Read only. |
| [poster](skills/jig/references/roles/poster.md) | fast/low | Use in jig-review-cycle, on the orchestrator's command, to post one merge request's findings from its state file, resolve threads and post replies. Executes only; decides nothing. |
| [referee](skills/jig/references/roles/referee.md) | deep/high | Use in the coliseum cross-judge (module-design) to score candidate designs against the rubric and red flags and name a base. Read only; verifier judges review findings. |
| [reflect-divergent](skills/jig/references/roles/reflect-divergent.md) | deep/high | Use in the weekly loop (references/loop.md) to turn jig loop candidates into proposals through the divergent lens: what the others miss, including a wrong rule. |
| [reflect-judgment](skills/jig/references/roles/reflect-judgment.md) | deep/high | Use in the weekly loop (references/loop.md) to turn jig loop candidates into proposals through the judgment lens: mistakes that need a better atom or flow step. |
| [reflect-synthesizer](skills/jig/references/roles/reflect-synthesizer.md) | deep/high | Use in the weekly loop (references/loop.md) to merge the three reflect tables and filter proposals into accepted, rejected and backlog. |
| [reflect-tooling](skills/jig/references/roles/reflect-tooling.md) | deep/high | Use in the weekly loop (references/loop.md) to turn jig loop candidates into proposals through the tooling lens: mistakes a check, message or tool fix can stop. |
| [review-runner](skills/jig/references/roles/review-runner.md) | deep/medium | Use in jig-review-cycle, one per actionable merge request in its worktree, to run jig-review end to end and return its proof of run. Never posts. |
| [synthesizer](skills/jig/references/roles/synthesizer.md) | deep/high | Use in investigation (Why step) to reconcile the investigators' evidence into found, inferred and unknown. Hunts for gaps; explainer merges code maps for How instead. |
| [verifier](skills/jig/references/roles/verifier.md) | deep/medium | Use in jig-review, one per cluster of candidates, to judge them on a different model than the finder: a verdict, severity and class per candidate, each on a quoted line. |

</details>

<!-- roles:end -->

## Agents

v1 ships the Claude Code adapter. The core and its event model do not depend on the agent, so Cursor and Codex adapters can follow ([what each agent offers a plugin](docs/agents.md)).

## Docs

[Hooks and gates](docs/hooks.md) · [Configuration](docs/configuration.md) · [UI proof](docs/ui-proof.md) · [Review cycle](docs/review-cycle.md) · [Flows, atoms and roles](docs/flows.md) · [Commands](docs/commands.md) · [Agents](docs/agents.md) · [Evals and benchmarks](docs/evals.md)

MIT © Artem Petukhov
