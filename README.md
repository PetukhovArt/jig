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
- **Thin on top.** Knowledge lives in short atoms read when their trigger applies; flows run only when you type `/jig`. One CLI, Node >= 20, no runtime dependencies.

## Quick start

In Claude Code 2.1.275 or later:

```text
/plugin install jig --marketplace PetukhovArt/jig
/jig-init
/jig <task>
```

`/jig-init` discovers your tools, asks only what code cannot know, writes `.jig/config.jsonc` and runs `jig doctor`. Its first step, `jig init`, on a Vue demo project:

```text
jig init: discovery by the jig catalog; nothing is written.

found:
  tsc          ready; markers tsconfig.json; packages typescript; binary not installed
  eslint       ready; markers eslint.config.mjs; packages eslint; binary not installed
  agent-view   ready; markers agent-view.config.json; binary C:\Program Files\nodejs\node.exe C:\Users\me\AppData\Roaming\npm\node_modules\@petukhovart\agent-view\dist\cli\index.js
not found: oxlint, stratum
eslint-plugin-boundaries: absent
type check: no type-check script in package.json, jig runs tsc

ask the user (code cannot know):
  - App run command (slots.dev) and install command (slots.install), if the project runs an app.
  - agent-view for UI proof (configured): needed? Setup: agent-view init.
  - stratum for module layers (not installed): needed? Setup: stratum-lint init, then stratum-lint baseline.

proposal for .jig/config.jsonc:
{
  "$schema": "https://raw.githubusercontent.com/PetukhovArt/jig/main/schema/config.schema.json",
  "tsc": {},
  "eslint": {},
  "agent-view": {}
}
```

<details><summary><b>Install from a shell</b></summary>

```text
claude plugin marketplace add PetukhovArt/jig
claude plugin install jig@petukhovart
```

Then run `/jig-init` in your project, or `node <plugin root>/bin/jig.mjs doctor` to see the config, each catalog tool and anything missing.

</details>

## Usage

The hooks need nothing from you: once `.jig/config.jsonc` names the tools, every edit and every turn goes through them ([hooks and gates](docs/hooks.md)).

For a task that needs rigor, start with `/jig` and say how you will know it is done:

```text
/jig the camera list flickers when a filter changes. reproduce it first, then fix and prove it in the app.
/jig i'm going to bed. move every caller of the sync store to the async one, behavior unchanged.
```

It restates the task with a done check, picks a flow and copies the flow's steps into the todo list. Every code-changing flow ends with the shared [`mr`](skills/jig/flows/mr.md) step: review your own diff, prove the UI, `jig pre-mr`, then the merge request.

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

`/jig` reaches for the rest when a step needs them. The ones you type yourself most:

| skill | use it when |
| --- | --- |
| [`/jig`](skills/jig/SKILL.md) | a task needs a flow: pick it, track its steps, prove the result |
| [`/jig-init`](skills/jig-init/SKILL.md) | setting jig up for a project, or settling it after the project changed |
| [`/jig-review`](skills/jig-review/SKILL.md) | reviewing someone else's merge request, or your own diff before the merge request (`pre-mr`) |
| [`/jig-review-cycle`](skills/jig-review-cycle/SKILL.md) | every merge request awaiting your review, in one pass ([review cycle](docs/review-cycle.md)) |

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

## Atoms and roles

Atoms are the knowledge: short rules an agent reads when their trigger applies, indexed in [`skills/jig/SKILL.md`](skills/jig/SKILL.md). Roles are subagent templates the flows spawn, each with a model tier and an effort ([more](docs/flows.md)).

<!-- atoms:start -->

<details><summary><b>All 28 atoms</b></summary>

**Process**
- [`automate-repeats`](atoms/automate-repeats.md): Apply to any non-trivial edit, migration, analysis or check
- [`autonomy`](atoms/autonomy.md): Apply when you are about to ask the human 'should I do X?' or to stop and wait
- [`context-window`](atoms/context-window.md): Apply when context fills up: large outputs, long files, repeated reads, fan-out work
- [`lessons-to-checks`](atoms/lessons-to-checks.md): Apply when you catch yourself writing the same instruction a second time, or see a recurring correction or review finding
- [`questions`](atoms/questions.md): Apply before you ask the human anything, or when you interview them about a plan
- [`small-steps`](atoms/small-steps.md): Apply to multistep work and to how you stack commits and merge requests
- [`writing-for-agents`](atoms/writing-for-agents.md): Apply when you write or edit text an agent runs on: a skill, a flow, an atom, a role, AGENTS.md or CLAUDE.md

**Design**
- [`design-it-twice`](atoms/design-it-twice.md): Apply when facing a novel module interface, data shape or architectural decision with no precedent in the codebase, or when a new requirement lands in an existing design
- [`do-less`](atoms/do-less.md): Apply when sizing a change, adding an option or abstraction, or sequencing an addition
- [`domain-model`](atoms/domain-model.md): Apply when writing stateful logic, designing types, or when code branches a lot on the same shape
- [`module-depth`](atoms/module-depth.md): Apply before you write code that crosses a function boundary: a new or changed signature, exported type or module surface
- [`one-way`](atoms/one-way.md): Apply when introducing a new API, abstraction or way of doing a task while old ones exist
- [`patterns`](atoms/patterns.md): Apply when designing a module interface with two or more variants, or when untangling complex code: a switch on type, an instanceof chain, duplicated conditional creation, an import cycle
- [`shared-state`](atoms/shared-state.md): Apply when concurrent actors, modules or runs might write the same file, key, branch or state object, or when a command must survive crashes and retries
- [`system-edges`](atoms/system-edges.md): Apply when wiring validation, error handling, adapters or imports across modules

**Code**
- [`comments`](atoms/comments.md): Apply when you add, keep or review a code comment
- [`dead-code`](atoms/dead-code.md): Apply when deleting code believed unused, or reviewing a diff that leaves an export, file or branch nothing reaches
- [`docs`](atoms/docs.md): Apply when writing, editing or reviewing a Markdown document (README, docs, ADR, glossary)
- [`effects`](atoms/effects.md): Apply when writing or reviewing reactive code (Vue, React, Solid, signals, stores)
- [`tests`](atoms/tests.md): Apply when you write, change, keep or review a test
- [`typescript`](atoms/typescript.md): Apply when reading or editing TypeScript

**Proof**
- [`change-impact`](atoms/change-impact.md): Apply before you change code other code depends on
- [`evidence`](atoms/evidence.md): Apply to every claim in a reply or report
- [`prove-shippable`](atoms/prove-shippable.md): Apply after completing a task, before declaring done
- [`root-causes`](atoms/root-causes.md): Apply when debugging
- [`why-this-number`](atoms/why-this-number.md): Apply before you trust, report or act on a measured number: a speedup, a regression, a latency, a throughput, an eval score

**Review**
- [`reader-cost`](atoms/reader-cost.md): Apply when shaping or reviewing code that is hard to trace
- [`smells`](atoms/smells.md): Apply when judging whether a hunk is a code smell

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
