# Software Factory in Jig / Berth: what to account for, what to grill, how to roll out and test

A starting point for a separate session. It collects the takeaways from two sources, what Jig already has, open questions for the grill, and a draft rollout and test plan. The document holds no decisions: we make them in the session and record them in the table at the end.

Sources:
- Will Larson, *Shipping 100+ PRs to production in a week* (Imprint, 2026-11-22) and related posts: software factory, verification pattern, small-change, Explorer.
- Ben Holmes, *There are countless ways to define a software factory* (Warp, 2026-11-24).
- Jig code as of 2026-11-26 and issue [#50 `jig distress`](https://github.com/PetukhovArt/jig/issues/50).

---

## 1. Frame: what we call a factory

**Working definition:** a loop outside the laptop that work enters with no human involved and that moves the work through a pipeline of typed stages. The pipeline has a human gate before implementation and proof after it. The process itself is versioned, measured and improved.

| | Who queues the work | Lifetime | Example |
| --- | --- | --- | --- |
| Task | a human | one run | `/jig fix X` |
| Loop | a schedule | forever, narrow goal | `mr-watching` on `/loop`, flag cleanup |
| **Factory** | an event or a goal | forever, finds work itself | labelled issue → MR; project goal → new tasks |

Two kinds of factory:
- **Backlog factory (Holmes).** Every issue goes through one pipeline. Works well on small, clear tasks, badly on features with product decisions.
- **Goal factory (Larson).** One factory per project. It holds a goal and a metric and files the missing tasks itself.

The anti-pattern both warn about: the **slop cannon**. Backlog automation with no human gate and no verification, which produces PRs nobody trusts and nobody reads.

---

## 2. Lessons from Larson (Imprint)

**Main idea:** productivity grows by removing the current bottleneck of the "task → PR → release" loop. The bottleneck keeps moving: tasks → PR quality → approvals → running out of simple work → hard work.

What had to be built before the factory, in order:
1. CI/CD and feature flags. Nothing works without them.
2. Knowledge-base cleanup. Context moved into the repository, wrong docs deleted, then loops added that update stale docs from code changes.
3. One source of work state (Linear), where tasks are filed from the UI, Slack and by agents.
4. A cloud harness, `fleet`: runs without a laptop, reacts to events (no polling), handles concurrency, has MCP by default. For people to use it, it must be **better than the local experience**.
5. An internal MCP for configuration: the agent proposes a change, a human approves by role.
6. Approvals through `small-change`. It turned out the real limit was not approval speed but **PR quality**.
7. **Verification files** (`verifications/{pr}.md`): what was checked and **what could not be checked**. A PR does not leave draft without such a file. The gaps are reviewed daily and turned into tasks. The admitted weak point: it is the agent's self-report.
8. **Simple work ran out.** It was added back through maintenance loops, events (security, errors, support, `distress`) and the factory.
9. `/my-open-work`: a morning triage of all open work.
10. Hard work follows the Explorer pattern.

Larson's factory (`/linear-project-loop`):
1. Goal audit: is there an RFC with goals and approach, and are there metrics (a dashboard or queries). If something is missing, it works it out with a human.
2. State review: metrics and tasks. Files new tasks and updates statuses.
3. Works unblocked tasks: a PR, a review request or a clarifying question.
4. Project description freshness check: fresh → next task, stale → back to step 1.
5. Post-release mode, less often: watches adoption and errors.

Larson's conclusions:
- The factory surfaces knowledge about goals that lived in people's heads. That is a plus.
- The parts reinforce each other only when everything else is in place: metrics, a single tracker, a harness outside the laptop.
- Triage of the factory's proposals needs an attentive human. He does not describe how to do it.
- PRs per week on its own means little. His PRs are simpler than those of the strongest engineers.
- He is skeptical of the "CI/CD and code review are dead" claim.

---

## 3. Lessons from Holmes (Warp)

- **A blueprint, not prose.** Stages are described as structure: `prompt` (a separate md), typed `inputs` and `outputs`, `to` (where next), `workers`. That gives a uniform result shape, visualization and debugging.
- **Workers** are separate sandboxes with their own context. The foreman talks to the human, the builder writes code undisturbed.
- **Trigger:** a label on an issue starts a run. On small tasks it costs under a dollar per issue on an open-weight model.
- **Triage** with three exits: implement right away / a feature with open product decisions → spec / just a question, answer without code.
- **Spec:** the agent asks questions before code (surface, scope, edge cases) and writes the behavior and the technical approach. **The Validation section of the spec becomes the verification checklist.** The spec is committed like code.
- **Verification on a computer.** A skill knows how to start the app, walk through the scenario and record proof. The agent adds **gotchas** to the skill over time. Visual proof goes into the PR: a path, a video, before/after.
- **Merge risk** on five axes: alignment (no undeclared edits), impact (blast radius, sensitive areas), verification, rollback (reversible or irreversible decision), error detection (will we see a failure in prod). Result: low, medium or high plus gaps. **The implementer runs the assessment before the PR**, so it can close the gaps in time.
- Next in his plans: code review benchmarks before the PR, a separate research agent to save tokens, runners for native platforms.

---

## 4. Overlaps and differences

| Topic | Larson | Holmes | What it means for us |
| --- | --- | --- | --- |
| Source of work | project goal and metric | issue backlog | we need both modes or a deliberate choice of one |
| Process format | a skill (prose) | YAML blueprint | Jig today is prose in `.md` |
| Human gate | goal audit, triage of proposals | triage and spec before code | for us, questions are async, in an inbox |
| Verification | verification file, formal verification | computer use and visual proof | Jig is stronger for UI, weaker for non-UI |
| Risk | deterministic `small-change` | 5 axes, assessed by the agent | open question for a solo developer |
| Improvement | maintenance loops, gap review | gotchas in skills | Jig has the journal and `jig loop` |
| Runtime | `fleet`, cloud, events | Warp Factories, sandboxes | this is Berth |

---

## 5. What Jig already has and what is missing

| Factory stage | In Jig now | Gap |
| --- | --- | --- |
| Trigger and intake | none | events → task |
| Triage | `/jig`: task statement, done check, flow choice | explicit "answer only" and "needs a spec" exits |
| Spec | `jig-grill` | the spec is not written to a file, has no Validation, no link to verification |
| Implement | `feature` and `bug-fix` flows, delegates, worktree | — |
| Verify | `ui` flow, `jig pre-mr`, `break-it`, `jig-video` | for non-UI only the `skip-verify` level; no "not checked" line (the `jig-visual-mr` template explicitly forbids mentioning skips) |
| Review | `jig-review pre-mr`, a judge on another model | — |
| Risk | `Rollback` and "What can break" in the MR template | an overall verdict for sorting the queue |
| Queue → MR stack | `afk-mode` in queue mode | — |
| Taking an MR to merge | `mr-watching`, verified stack, `patch-id` | — |
| Decision trail | `jig-task-status`, `journal-auditor` | — |
| Improvement | journal, `jig loop`, `eval` flow | judgement signals — [#50](https://github.com/PetukhovArt/jig/issues/50) |
| Blueprint and run state | — | a structure of stages, their inputs and outputs |
| Runtime outside the laptop, workers | — | Berth |
| Question inbox | `open` questions in the task-status TSV | a shared inbox across all runs |

---

## 6. Draft split between Jig and Berth (to discuss)

- **Berth is the factory runtime:** triggers, workers (worktree or sandbox), run state, pipeline visualizer, inbox, schedule, retry and recovery.
- **Jig is the content of the stages:** triage, spec, implement, verify, review, risk as skills and CLI with **machine-readable** output (schemas in `schema/`).
- **The contract** between them is a blueprint where each stage points to a harness skill and describes the shape of its input and output. Berth does not know about Jig, it knows only the contract.

---

## 7. Questions for the grill

### 7.1 Why and where
1. Which pain do we solve first: my attention across many parallel sessions, the flow of simple work, or trust in PRs? The answer sets the first stage.
2. Which repository do we break it in on: Jig, Berth or both? Where is the cost of a mistake lower and the signal more honest?
3. Which modes: backlog, goal or both? If both, which first and why?
4. Which single number tells us in a month that the factory paid off?

### 7.2 Intake
5. Task source: GitHub issues with a label, a text file or a Berth queue? Do we need a single tracker, like Linear for Larson?
6. Which events besides labels: red CI on main, `distress` from the journal, `jig loop` findings, runtime errors?
7. Deduplication: what happens when one event arrives twice or the task is already in progress?

### 7.3 Blueprint
8. Which format describes the pipeline: YAML or JSON with a schema, code (TS), or keep prose in the flows?
9. Where does the blueprint live: in the project repo, in Jig as a default, or in Berth?
10. The minimal set of stages for v1. The inputs and outputs of each are the contract format.
11. How do Jig flows give structured output without breaking current use from chat?

### 7.4 Triage and spec
12. Who does triage: a separate worker (cheap model) or the same agent?
13. How to tell a "clear task" from "has open decisions": a rule, a checklist or model judgement? How do we measure accuracy?
14. Spec: a file in the repo (committed) or in `.jig/runs/<branch>/`? Which template? Is Validation mandatory?
15. How do questions reach me and how does an answer resume the run: the Berth inbox, an issue comment, `Copy answers` from task-status?
16. What does a run do while it waits for an answer: pause, other tasks, or implementation with a default and a mark?

### 7.5 Workers and runtime
17. Is a worker a worktree on my machine, a remote machine or a cloud sandbox? What in v1?
18. Split foreman and builder? Do we need a "front-door" agent you can ask for status?
19. How many runs in parallel? How to share ports, the dev server and slots (`jig-slots`)?
20. Recovery: a worker crashed mid-run. What is visible, what restarts, what rolls back?
21. How do UI checks avoid taking my focus in background mode (rule from SKILL.md: "A check never takes the user's focus")?

### 7.6 Verification
22. Do we add "not checked" to Evidence, against the current template rule?
23. Do we reconcile Evidence with the journal (`gate-pass`/`proof` by `tree`), or is the self-report enough for now?
24. How does Validation from the spec turn into checks: each item → a replay step or a command?
25. Is there room for invariant checks (formal or property-based) on Berth's state machines?

### 7.7 Risk and acceptance
26. Does a solo developer need a risk assessment? If so, for sorting the queue or for automatic actions?
27. Deterministic (size, stratum layers, sensitive paths) or model judgement, like Holmes? Or a hybrid?
28. What is the factory always forbidden to do: merge, deploy, force-push, delete, message people. Confirm that `afk-mode` already covers this for the factory.

### 7.8 Inbox and attention
29. What goes into the inbox: spec questions, MRs to review, `blocked`, `distress`, failed runs?
30. Do we need a new `my-open-work` skill as a morning pass before the Berth inbox UI exists?
31. How many minutes a day am I ready to spend on the factory? That is the budget the question frequency is tuned to.

### 7.9 "Better over time"
32. Where do gotchas go: the project skill, a Jig atom or the journal?
33. How does the factory use `jig loop`: only reads it, or opens MRs with proposals that I approve?
34. How do we version the blueprint and stage prompts, and how do we compare versions (`eval` flow)?

### 7.10 Cost and models
35. Which stages on which tier (`jig tiers`): triage and intake on fast, spec and review on deep?
36. Do we need local models for the cheap stages?
37. Is there a budget per run or per day, and what happens when it is exceeded?

---

## 8. Draft rollout plan

Each stage must be useful on its own and have an exit criterion.

| # | Stage | What we do | Exit criterion |
| --- | --- | --- | --- |
| 0 | Foundation | `distress` (#50), a "not checked" line in Evidence, `--json` on the needed commands | `jig loop` sees `distress`; Evidence honestly shows the gaps |
| 1 | Single-stage factory | issue label → worker in a worktree → `/jig <issue>` in afk → MR | 10 simple issues → MR with no involvement from me before review |
| 2 | Triage gate | three exits; a spec with questions to the inbox or issue; resume after the answer | on a mixed corpus, triage sends to spec what I would send myself |
| 3 | Spec → verification | Validation from the spec becomes mandatory checks; Evidence comes from them | every Validation item shows in the MR as checked or not checked |
| 4 | Morning triage | a new `my-open-work` skill or the Berth inbox | one pass shows everything waiting for me |
| 5 | Blueprint | v1 stages as a structure in Berth; a run visualizer | the screen shows which stage each run is at and why it is stuck |
| 6 | Goal mode | goal and metric, freshness audit, post-release | the factory filed tasks on its own that I accepted |
| 7 | Risk (if needed) | a verdict for sorting the queue | the queue order matches mine |

---

## 9. Factory test plan

### 9.1 Corpus
- 20–30 real tasks from Jig and Berth, labelled in advance:
  - clear small edits (expected: straight to implementation);
  - features with open decisions (expected: spec and questions);
  - questions (expected: an answer without code);
  - UI tasks (expected: proof in the app);
  - deliberately bad or impossible ones (expected: an honest stop or `distress`).
- For each task, record in advance: the expected triage route, which questions should be asked, and the MR acceptance criterion.

### 9.2 Metrics
| Metric | What it shows |
| --- | --- |
| Triage accuracy (match with the labels) | whether the gate works or lets junk through |
| Question usefulness (share I would have asked myself) | no interrogation for its own sake |
| MR accepted without rework (%) | trust in the result |
| My minutes per MR (questions and review) | whether the factory pays off in attention |
| Verification honesty: claimed vs journal | no self-report beyond what was done |
| Escapes: defects found after merge | whether the pipeline catches errors |
| Run cost (tokens, time) | economics per tier |
| Share of runs that finished without crashing | runtime reliability |

### 9.3 Comparisons (through the `eval` flow)
- Factory without triage vs with triage, on the same corpus.
- With the spec → Validation check vs without it.
- Different tiers on the cheap stages.
- Every change to a stage prompt or the blueprint runs on the corpus before it stays.

### 9.4 Fault injection
- A worker killed mid-run: check recovery and that no junk branches or worktrees are left.
- A conflict with main during a run.
- The app does not start or the UI check is flaky.
- Two tasks write to the same file.
- A question in the inbox unanswered for N hours.
- A seeded bug that verification must catch: a check that it can fail at all.

### 9.5 Dogfooding
- A week on Jig: the factory takes labelled issues.
- A week on Berth.
- A retro from the journal, `jig loop` and task-status.

---

## 10. Risks and anti-patterns

- **Slop cannon:** a stream of PRs with no gate and no proof.
- **Interrogation:** triage asks about everything, and attention costs more than without the factory.
- **Self-report:** Evidence describes more than was done.
- **Factory worse than the local experience:** then nobody uses it (the `fleet` lesson).
- **Running out of simple work:** the factory idles or generates needless tasks itself.
- **Stale context:** wrong docs and glossary poison every run.
- **Metric for the metric's sake:** PR count instead of accepted MRs and my minutes.
- **Berth coupled to Jig:** the runtime starts to know the harness internals.
- **Irreversible actions** in background mode.

---

## 11. Session decisions

| # | Question | Decision | Why | Date |
| --- | --- | --- | --- | --- |
| | | | | |
