---
name: jig
description: "Run a task through a jig flow: pick the flow, track its steps, prove the result."
disable-model-invocation: true
argument-hint: "<task, with how you will know it is done>"
---

# jig

Plugin root: `${CLAUDE_PLUGIN_ROOT}`. Below, `<root>` means this path.
CLI: `node <root>/bin/jig.mjs <command>`; `jig <command>` in flows means this. Atoms: `<root>/atoms/<name>.md`. Flows: `<root>/skills/jig/flows/<name>.md`. Roles: `<root>/skills/jig/references/roles/<name>.md`, indexed with tier and effort in `<root>/skills/jig/references/roles.md`.

## Non-negotiables
These hold for the whole task, in every flow.
- **Evidence.** Every claim carries its label in the same sentence: measured (you ran it and saw the output), inferred (from code you read, with `file:line`), or guess (say what would confirm it). A fact you can observe by running something, you run; never hand the human a check you could run. Never fabricate a link, an output or a citation.
- **hitl by default.** Reversible work proceeds without asking: edits, local commits, branches, worktrees, checks, subagents. A fact is looked up or run, never asked. A fork you can settle by running something is settled by an experiment. Only a real product or taste choice goes to the human: ask it in your reply, with your recommendation, and wait (format: atom `questions`).
- **afk** when the human said they are away or must not be waited on ("going to bed", "don't stop", "until done") or the flow is `afk-mode`: take the default you recommend, keep going, and list in the final report each question, the option you took and what the human could tell you instead.
- **Irreversible waits, always**: force-push to a shared branch, deploys, deleting data or branches you did not create, messages to other people, merging, publishing.
- **Questions are text in your reply.** A tool that blocks the session on a question, or may be turned off, is not a channel.
- **Context window.** Bulk reading (many files, long logs, wide searches) goes to a subagent with pointers (paths, line ranges), not pasted content. You own every subagent's output: check its diff or claims and write your own summary.

## Before the first step
1. Restate the task in one line each: the goal, the done check (something that can pass or fail), the proof you will show, what is already known, the constraints. Missing done check: propose one and continue with it.
2. Pick the flow whose description fits. None fits, or the work is large and cross-cutting: `custom-flow`.
3. Read the flow file. Put each of its numbered steps into your todo tool as its own item, verbatim, before any task-specific items. A step that does not apply: rewrite its item text to `skip: <reason>` and mark it completed. The session cannot end with an open item: the stop hook blocks it.

## While working
- When a step names an atom, read `<root>/atoms/<name>.md` before acting on that step. When what you are about to do matches a trigger in the atom index below, read that atom too.
- When a step names a role, spawn a subagent whose prompt begins `Read <root>/skills/jig/references/roles/<name>.md and follow it.`, then your brief: goal, scope, file pointers, and the paths of the atoms it must read. Do not read the role file yourself. Its tier and effort are in `references/roles.md`; run `jig tiers` once per session for the models of each tier; no mapping for this agent: pick the model that fits the tier description in `references/tiers.md`. Review what it returns; do not pass its text through.
- Code crossing a function boundary → `flows/module-design.md` before writing it.
- **agent-view configured**: `.jig/config.jsonc` (or `.jig/config.local.jsonc`) names `"agent-view"` and does not set it to `false`, the same test `jig pre-mr` uses; an `agent-view.config.json` alone does not count. Configured: a step that drives the app uses agent-view on the runtime `agent-view.config.json` names in `runtime` (electron, tauri or browser) and on its `port`, never a browser or port 9222 by default. Not configured: that step is `skip: agent-view not configured`.
- Hooks may deny an edit or keep you from finishing. Read the reason, fix the cause, do not work around it.

## Atoms
<!-- atoms:start -->
**Process**
- `automate-repeats`: Apply to any non-trivial edit, migration, analysis or check
- `autonomy`: Apply when you are about to ask the human 'should I do X?' or to stop and wait
- `context-window`: Apply when context fills up: large outputs, long files, repeated reads, fan-out work
- `lessons-to-checks`: Apply when you catch yourself writing the same instruction a second time, or see a recurring correction or review finding
- `questions`: Apply before you ask the human anything, or when you interview them about a plan
- `small-steps`: Apply to multistep work and to how you stack commits and merge requests
- `writing-for-agents`: Apply when you write or edit text an agent runs on: a skill, a flow, an atom, a role, AGENTS.md or CLAUDE.md

**Design**
- `design-it-twice`: Apply when facing a novel module interface, data shape or architectural decision with no precedent in the codebase, or when a new requirement lands in an existing design
- `do-less`: Apply when sizing a change, adding an option or abstraction, or sequencing an addition
- `domain-model`: Apply when writing stateful logic, designing types, or when code branches a lot on the same shape
- `module-depth`: Apply before you write code that crosses a function boundary: a new or changed signature, exported type or module surface
- `one-way`: Apply when introducing a new API, abstraction or way of doing a task while old ones exist
- `patterns`: Apply when designing a module interface with two or more variants, or when untangling complex code: a switch on type, an instanceof chain, duplicated conditional creation, an import cycle
- `shared-state`: Apply when concurrent actors, modules or runs might write the same file, key, branch or state object, or when a command must survive crashes and retries
- `system-edges`: Apply when wiring validation, error handling, adapters or imports across modules

**Code**
- `comments`: Apply when you add, keep or review a code comment
- `dead-code`: Apply when deleting code believed unused, or reviewing a diff that leaves an export, file or branch nothing reaches
- `docs`: Apply when writing, editing or reviewing a Markdown document (README, docs, ADR, glossary)
- `effects`: Apply when writing or reviewing reactive code (Vue, React, Solid, signals, stores)
- `tests`: Apply when you write, change, keep or review a test
- `typescript`: Apply when reading or editing TypeScript

**Proof**
- `change-impact`: Apply before you change code other code depends on
- `evidence`: Apply to every claim in a reply or report
- `prove-shippable`: Apply after completing a task, before declaring done
- `root-causes`: Apply when debugging
- `why-this-number`: Apply before you trust, report or act on a measured number: a speedup, a regression, a latency, a throughput, an eval score

**Review**
- `reader-cost`: Apply when shaping or reviewing code that is hard to trace
- `smells`: Apply when judging whether a hunk is a code smell
<!-- atoms:end -->

## Flows
<!-- flows:start -->
- `afk-mode`: work unattended toward a checkable done condition, or turn a queue of tasks into a stack of merge requests the human lands.
- `bug-bash`: attack a feature in the running app and report reproduced bugs.
- `bug-fix`: reproduce, find the root cause, fix, prove.
- `custom-flow`: no flow fits, or the work is large and cross-cutting: frame it, design its workflow, run each unit as an experiment, leave a decision trail.
- `diagnose`: find the cause of a symptom without fixing it, from a live process or a captured artifact; the fix is bug-fix.
- `eval`: measure how a change to an atom, flow or skill changes agent behavior before you keep it.
- `feature`: build new behavior with the right data shape and prove it on the running product.
- `investigation`: understand code or a decision without changing it.
- `metric-climb`: improve one metric over many measured attempts until a stop predicate holds; a one-off slowness fix is perf.
- `module-design`: ground, sketch two shapes in parallel, pick by depth, implement against the sketch.
- `mr-watching`: drive your open merge requests through conflicts, threads and CI, and land a verified stack when the user says so.
- `perf`: measure, explain the limiter, fix, measure again.
- `prototype`: settle a design decision with a throwaway instrument.
- `refactoring`: change structure, keep behavior, prove equivalence.
- `session-pause`: stop cleanly with a resume point.
- `session-resume`: resume work a previous session left.
- `ui-match`: make UI match a reference: a design (Figma, an image) or an existing implementation.
<!-- flows:end -->
Every code-changing flow ends with the shared step in `flows/mr.md`.
Reviewing someone else's merge request: the `jig-review` skill in mode `review`.
The weekly improvement loop: when the user asks for it, follow `references/loop.md`.

## Reply
Follow the flow's `Reply:` contract. Name each atom that changed a decision and the decision it changed; an atom named without one is noise.
