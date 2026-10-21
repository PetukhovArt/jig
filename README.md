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

<details><summary><b>Flows</b></summary>

| flow | for |
| --- | --- |
| [investigation](skills/jig/flows/investigation.md) | understand code or a decision without changing it |
| [diagnose](skills/jig/flows/diagnose.md) | find the cause of a symptom from a live process or a captured artifact, without fixing it |
| [bug-fix](skills/jig/flows/bug-fix.md) | reproduce, find the root cause, fix, prove |
| [feature](skills/jig/flows/feature.md) | build new behavior with the right data shape and prove it on the running product |
| [module-design](skills/jig/flows/module-design.md) | sketch two module shapes in parallel, pick by depth, implement against the sketch |
| [refactoring](skills/jig/flows/refactoring.md) | change structure, keep behavior, prove equivalence |
| [perf](skills/jig/flows/perf.md) | measure, explain the limiter, fix, measure again |
| [metric-climb](skills/jig/flows/metric-climb.md) | improve one metric over many measured attempts until a stop predicate holds |
| [prototype](skills/jig/flows/prototype.md) | settle a design decision with a throwaway instrument |
| [ui-match](skills/jig/flows/ui-match.md) | make UI match a design or an existing implementation |
| [bug-bash](skills/jig/flows/bug-bash.md) | attack a feature in the running app and report reproduced bugs |
| [eval](skills/jig/flows/eval.md) | measure how a change to an atom, flow or skill changes agent behavior |
| [mr-watching](skills/jig/flows/mr-watching.md) | drive your open merge requests through conflicts, threads and CI |
| [afk-mode](skills/jig/flows/afk-mode.md) | work unattended toward a checkable done condition, or turn a queue of tasks into a stack of merge requests |
| [session-pause](skills/jig/flows/session-pause.md) | stop cleanly with a resume point |
| [session-resume](skills/jig/flows/session-resume.md) | resume work a previous session left |
| [custom-flow](skills/jig/flows/custom-flow.md) | no flow fits, or the work is large and cross-cutting |

</details>

## Skills

`/jig` runs most of them when a step needs them. Use one directly when you want just that:

| skill | use it when |
| --- | --- |
| [`/jig`](skills/jig/SKILL.md) | a task needs a flow: pick it, track its steps, prove the result |
| [`/jig-init`](skills/jig-init/SKILL.md) | setting jig up for a project, or settling it after the project changed |
| [`/jig-review`](skills/jig-review/SKILL.md) | reviewing someone else's merge request (threads, `--post`, re-review), or your own diff before the merge request (mode `pre-mr`) |
| [`/jig-review-cycle`](skills/jig-review-cycle/SKILL.md) | every merge request awaiting your review, in one pass ([review cycle](docs/review-cycle.md)) |
| [`/jig-slots`](skills/jig-slots/SKILL.md) | work runs in parallel: a worktree per task, and finished branches shown in a slot with a warm dev server |
| [`/jig-task-status`](skills/jig-task-status/SKILL.md) | a long or unattended run needs a reviewable decision trail |
| [`/jig-grill`](skills/jig-grill/SKILL.md) | a plan or decision should be questioned until nothing is silently assumed |
| [`/jig-prune-comments`](skills/jig-prune-comments/SKILL.md) | comments the rules do not allow pile up across a merge request, a folder or the repository |
| [`/jig-explain`](skills/jig-explain/SKILL.md) | the current topic needs a visual explanation: call trees, file trees, diagrams |
| [`/jig-video`](skills/jig-video/SKILL.md) | a change needs a narrated demo video of its use cases |

## Agents

v1 ships the Claude Code adapter. The core and its event model do not depend on the agent, so Cursor and Codex adapters can follow ([what each agent offers a plugin](docs/agents.md)).

## Docs

[Hooks and gates](docs/hooks.md) · [Configuration](docs/configuration.md) · [UI proof](docs/ui-proof.md) · [Review cycle](docs/review-cycle.md) · [Flows, atoms and roles](docs/flows.md) · [Commands](docs/commands.md) · [Agents](docs/agents.md) · [Evals and benchmarks](docs/evals.md)

MIT © Artem Petukhov
