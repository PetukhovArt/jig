---
name: jig
description: "Run a task through a jig flow: pick the flow, track its steps, prove the result."
disable-model-invocation: true
argument-hint: "<task, with how you will know it is done>"
---

# jig

Plugin root: `${CLAUDE_PLUGIN_ROOT}`. Below, `<root>` means this path.
CLI: `node <root>/bin/jig.mjs <command>`. Atoms: `<root>/atoms/<name>.md`. Flows: `<root>/skills/jig/flows/<name>.md`. Role templates: `<root>/skills/jig/references/roles/<name>.md`. Atom index: `<root>/skills/jig/references/atoms.md`.

## Before the first step
1. Read these atoms; they hold for the whole task.
   Atoms: evidence, autonomy, questions, context-window.
2. Restate the task in one line each: the goal, the done check (something that can pass or fail), the proof you will show, what is already known, the constraints. Missing done check: propose one and continue with it.
3. Pick the flow whose description fits. None fits: take the closest one and say in one line why.
4. Read the flow file. Copy its numbered steps into the todo list verbatim, before any task-specific todos. A step you decide not to do stays in the list as `skip: <reason>`.
5. Run `node <root>/bin/jig.mjs dash init --lang <en|ru> "<task title>" "<step 1>" "<step 2>" ...` with the same steps. `--lang` is the language you and the user talk in this session; write the title, steps, decisions and questions in it too. Give the user the printed page path once.

## While working
- After every step: `dash step <n> done` and `dash step <n+1> active`. Each decision: `dash decision "<what>" --why "<why>" --evidence "<proof or file:line>"`. A discarded attempt: the same with `--result reverted`. Each deliverable: `dash result "<what>" "<path or link>"`.
- A question for the user: `dash ask "<question>" "<default>"`, then continue with the default. When the user answers: `dash answer <n> "<answer>"` and follow the answer.
- When a step names an atom, read `<root>/atoms/<name>.md` before acting on that step.
- When a step names a role, read its template and pass the full template text plus your brief (goal, scope, file pointers, the atoms it must read with their paths) as the subagent prompt. The subagent's model and effort come from the template's `tier:` line: run `node <root>/bin/jig.mjs tiers` once per session and use its mapping; when it prints no mapping for this agent, choose a model that fits the tier description in `references/tiers.md`. Review what it returns; do not pass its text through.
- Code crossing a function boundary → `flows/module-design.md` before writing it.
- Hooks may deny an edit or keep you from finishing. Read the reason, fix the cause, do not work around it.

## Flows
- `investigation`: understand code or a decision without changing it.
- `bug-fix`: reproduce, find the root cause, fix, prove.
- `feature`: build new behavior with the right data shape and prove it on the running product.
- `module-design`: ground, sketch two shapes in parallel, pick by depth, implement against the sketch.
- `refactoring`: change structure, keep behavior, prove equivalence.
- `perf`: measure, explain the limiter, fix, measure again.
- `prototype`: settle a design decision with a throwaway instrument.
- `ui-match`: make UI match a baseline or a UI design pixel for pixel.
- `review`: review a merge request (yours or someone else's) and post proven findings.
- `bug-bash`: attack a feature in the running app and report reproduced bugs.
- `mr-watching`: drive your open merge requests through conflicts, threads and CI.
- `afk-mode`: work unattended toward a checkable done condition.
- `session-resume`: resume work a previous session left.
- `session-pause`: stop cleanly with a resume point.
Every code-changing flow ends with the shared step in `flows/mr.md`.
The weekly improvement loop: when the user asks for it, follow `references/loop.md`.

## Reply
Follow the flow's `Reply:` contract. Label claims per atom `evidence` and name each atom that changed a decision.
