<div align="center">

# jig

**Guardrails for AI coding agents.**<br/>
Your agent can't finish a turn with a type error in its files, and can't open a merge request for a UI change nobody has seen working.

[![CI](https://github.com/PetukhovArt/jig/actions/workflows/ci.yml/badge.svg)](https://github.com/PetukhovArt/jig/actions/workflows/ci.yml) [![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE) [![node](https://img.shields.io/badge/node-%3E%3D20-339933.svg)](package.json) [![Claude Code plugin](https://img.shields.io/badge/Claude_Code-plugin-D97757.svg)](.claude-plugin/plugin.json)

</div>

Agents are good at writing code and bad at noticing when they broke something. A prompt that says "run the type checker" works until the context gets compacted, or until the model decides this one time it doesn't matter. jig moves those rules out of the prompt and into hooks and a small CLI. If a tool can check it, the tool checks it, every time. The model is left with the judgment calls.

## What you get

- **Checks that run whether the agent remembers or not.** Adding an `eslint-disable` or `@ts-ignore` is refused outright. A new comment or test case gets bounced once along with the rules for it, so the agent has to think before trying again. At the end of every turn, tsc, ESLint, stratum and your own checks run over the files that session touched, and an error keeps the turn open.
- **UI changes proven in the app.** Before a merge request, `jig pre-mr` wants a replayed use case and a screenshot for each changed component, or a written reason why there are none.
- **Reviews you can trust.** `jig-review` decides how many reviewers a diff needs, then a different model checks each finding before you see it. `jig-review-cycle` goes through every merge request waiting on you in one pass.
- **Works on an old codebase.** ESLint only looks at the lines the agent changed and tsc only at the files it touched. stratum starts from a baseline, so old violations don't block anyone.
- **Gets out of the way.** After three blocks in a row the gate stops blocking and writes it down, so the agent never loops on it. Edit hooks have a 300 ms budget (p95), the end-of-turn gate 20 s for 20 files, and the [benchmarks](docs/evals.md#benchmarks) check both.
- **Several agents at once.** Each task can get its own worktree. Finished branches can be shown in a slot with its own dev server and ports. Each session's gate only looks at its own files, and heavy checks take turns instead of all running at once.
- **Overnight runs you can check in the morning.** `afk-mode` keeps a log of every decision, and a separate agent compares that log with `git log` before you read the summary.
- **It improves from its own journal.** Every refusal, block and crash is written down. Once a week `jig loop` turns the repeats into proposed rules and checks, and nothing changes until you approve it.
- **Changes to it get measured.** Evals run the same tasks with and without the plugin, and a change to a rule goes through the [`eval`](skills/jig/flows/eval.md) flow before it stays.
- **Cheap models where they're enough.** Each subagent role has a tier: fast models prune comments and post threads, stronger ones judge findings and designs.
- **Light.** One CLI on Node 20+, no runtime dependencies. In your project it only creates `.jig/`.

## Who it's for

The core doesn't care which agent, language or framework you use: it deals in events, files and checks. In practice it was built for, and is best at, **Claude Code, TypeScript and frontend** apps (web, Electron, Tauri, monorepos included). Four things matter most:

- **Deterministic checks.** If code can decide something, code decides it: the gates, the review plan, whether a merge request may go, which merge requests need review. Same input, same answer. The model only gets the questions no tool can answer.
- **Architecture.** [stratum](https://github.com/PetukhovArt/stratum) checks module layers and boundaries on every edit, and the `module-design` flow sketches two designs before writing either.
- **Verification.** Types and lint every turn, the UI proven in the running app through [agent-view](https://github.com/PetukhovArt/agent-view), review findings confirmed by a second model.
- **Extensibility.** Other languages plug in through your own `checks`, other agents through an adapter, your team's review process through a [process adapter](docs/review-cycle.md#process-adapter).

| | works today | needs an extension |
| --- | --- | --- |
| agent | Claude Code | Cursor and Codex need an adapter ([agents](docs/agents.md)) |
| language | TypeScript, JavaScript, Vue; C# for the comment, test and suppression gates | anything, through a `checks` entry ([configuration](docs/configuration.md)) |
| project | web, Electron and Tauri apps, monorepos | backends, CLIs, libraries: everything except UI proof |
| platform | Windows, macOS, Linux; GitLab and GitHub | |

## Quick start

You need Claude Code 2.1.275 or later.

```text
/plugin install jig --marketplace PetukhovArt/jig
/jig-init
/jig <task>
```

`/jig-init` looks at your project, asks only what it can't figure out on its own, writes `.jig/config.jsonc` and runs `jig doctor` to check the result.

<details><summary><b>Install from a shell</b></summary>

```text
claude plugin marketplace add PetukhovArt/jig
claude plugin install jig@petukhovart
```

Then run `/jig-init` in your project. `node <plugin root>/bin/jig.mjs doctor` shows the config, each tool and anything missing.

</details>

## Usage

The hooks need nothing from you. Once `.jig/config.jsonc` names your tools, every edit and every turn goes through them ([hooks and gates](docs/hooks.md)).

### Just use [`/jig`](skills/jig/SKILL.md)

It's the only command you really need to remember. Use it for anything that deserves care, and tell it how you'll know the work is done:

```text
/jig the camera list flickers when a filter changes. reproduce it first, then fix and prove it in the app.
```

```text
/jig i'm going to bed. move every caller of the sync store to the async one, behavior unchanged.
```

It repeats the task back with a done check, picks a flow and puts the flow's steps in the todo list. Every flow that changes code finishes the same way ([`mr`](skills/jig/flows/mr.md)): it reviews its own diff, proves the UI, runs `jig pre-mr` and opens the merge request.

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

`/jig` calls `jig-review`, `jig-slots` and `jig-task-status` by itself when a step needs them. You can also run any skill on its own:

```text
/jig-review https://gitlab.example.com/team/app/-/merge_requests/412 --post
```

```text
/loop 2h /jig-review-cycle
```

The model can start three of them on its own, because a flow or a schedule needs them. The others run only when you type them ([why](docs/flows.md#who-starts-a-skill)).

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

## How it's built

**Basics first.** Think of Maslow's pyramid. An agent that can break the build gets nothing out of a clever plan, so the lower layers come first. They also last longest. The upper layers get thinner with each model release, because models learn to do that part themselves, so jig keeps them small ([more](docs/agents.md#the-harness-pyramid)).

```text
       evolution       journal, weekly loop                  ┐
     orchestration     /jig, flows, review, decision trail   │ thin: models catch up here
        context        atoms read when they apply            ┘
     verification      gates, tsc, ESLint, stratum, UI proof ┐
        safety         no suppressions, rules for comments   │ solid: worth the effort
       execution       worktrees, slots with a running app   ┘
```

**Rules live in hooks.** A rule that a tool can enforce goes in a hook. The model can't skip a hook, argue with it or forget it after compaction ([hooks and gates](docs/hooks.md)).

**UI proof means the real app.** Passing tests don't show that a screen still works. [agent-view](https://github.com/PetukhovArt/agent-view) clicks through the app the way a user would: a replayed use case covers the behavior and a screenshot covers the look ([UI proof](docs/ui-proof.md)).

**Architecture gets checked too.** Module layers and boundaries live in a [stratum](https://github.com/PetukhovArt/stratum) config and are checked on every edit, fast enough that nobody notices.

**Review findings need evidence.** Reviewers look for problems aggressively. Then a judge on a different model keeps only the findings it can point to on a quoted line.

**Short rules, read when they apply.** There's no giant system prompt. Each rule is a short file (an atom) with a one-line trigger, and the agent reads it only when the work matches.

## Atoms and roles

Atoms are those short rules, indexed in [`skills/jig/SKILL.md`](skills/jig/SKILL.md) by when in the work they apply. Roles are templates for the subagents that flows start, each with a model tier and effort ([more](docs/flows.md)).

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
| [review-runner](skills/jig/references/roles/review-runner.md) | standard/high | Use in jig-review-cycle, one per actionable merge request in its worktree, to run jig-review end to end and return its proof of run. Never posts. |
| [synthesizer](skills/jig/references/roles/synthesizer.md) | deep/high | Use in investigation (Why step) to reconcile the investigators' evidence into found, inferred and unknown. Hunts for gaps; explainer merges code maps for How instead. |
| [verifier](skills/jig/references/roles/verifier.md) | deep/medium | Use in jig-review, one per cluster of candidates, to judge them on a different model than the finder: a verdict, severity and class per candidate, each on a quoted line. |

</details>

<!-- roles:end -->

## Agents

Only the Claude Code adapter exists for now. The core doesn't depend on the agent, so Cursor and Codex adapters can be added ([what each agent lets a plugin do](docs/agents.md)).

## Docs

[Hooks and gates](docs/hooks.md) · [Configuration](docs/configuration.md) · [UI proof](docs/ui-proof.md) · [Review cycle](docs/review-cycle.md) · [Flows, atoms and roles](docs/flows.md) · [Commands](docs/commands.md) · [Agents](docs/agents.md) · [Evals and benchmarks](docs/evals.md)

MIT © Artem Petukhov
