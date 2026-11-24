# Evals and benchmarks

Rule fixtures run with the unit tests: `npm test`.

## Project instructions matrix

`evals/context-matrix/matrix.mjs` checks that an agent gets the `AGENTS.md`/`CLAUDE.md` chain of the file it edits before the edit, in each agent and layout. It builds a git repository under `~/.jig-context-matrix/` (outside the shared temp directory, where Grok loads no project hooks) whose rule files at three levels each demand an exported constant with a random value in an edited file, plus a glossary that names the expected field, and a linked worktree next to it. Each agent gets the same task, "add a boolean field to `Tab` in `src/a/b/tab.ts`", in four layouts: `main` (the file in the checkout the agent started in), `worktree` (the file in the sibling worktree, by absolute path), `worktree-session` (the agent started in the worktree) and `subagent` (the task delegated to a subagent, the file in the worktree). The judge reads the edited file: a run passes when it holds all three values; the field name shows whether the glossary was read.

```text
node evals/context-matrix/matrix.mjs [--harness claude,codex,grok] [--layout main,worktree,worktree-session,subagent] [--out results.json]
```

It runs `claude -p`, `codex exec` and `grok -p` with the user's own setup and accounts (the jig hooks must be installed for each, [agents](agents.md)), so a run costs real usage; each run writes `transcript.log` and, through `JIG_HOOK_LOG`, every hook input and output to `hooks.log` in its directory.

## Agent evals

Agent evals are five mini-projects in `evals/agent/` (`bug-fix`, `feature-ui`, `refactor`, `tests`, `review`), run through `claude plugin eval` with and without the plugin. `evals/agent-flow/` holds the same cases prompted with `/jig`.

```text
npm run eval:prepare
claude plugin eval . --case bug-fix --runs 1 --scaffold --allow-tools Write Edit MultiEdit "Bash(*)" --keep-temp
claude plugin eval . --eval-dir evals/agent-flow --scaffold --ablation none --allow-tools Write Edit MultiEdit "Bash(*)"
node evals/summarize.mjs evals/agent/results/<ts> evals/agent-flow/results/<ts>
```

Where `claude plugin eval` cannot run Bash cases (Windows without its sandbox), `evals/run-local.mjs` runs the same case files with plain `claude -p`:

```text
node evals/run-local.mjs --plugin . --case bug-fix --runs 1 --keep-temp
node evals/run-local.mjs --plugin . -j 3
node evals/run-local.mjs --plugin . --eval-dir evals/agent-flow -j 3
```

It runs `scaffold.sh` with Git Bash in a fresh temp dir, then the prompt with `--plugin-dir` (arm `with`) or without it (arm `without`; `evals/agent-flow` runs `with` only). Both arms skip your own setup: user settings, hooks, plugins, MCP servers, `CLAUDE.md` and auto-memory. Each run gets its own `TMPDIR`/`TEMP`/`TMP` and a free port in `JIG_APP_PORT` for the app it drives, so parallel runs (`-j`) do not drive each other's app (the agent points its app control tool at it, as in the `jig-slots` skill); a literal `/tmp/...` path in a shell command stays shared. `regex` and `llm` graders (judge: `--judge-model` and `--judge-effort`, opus at high by default) score each run. A `flow` grader (run-local only) checks the steps its body lists as a JSON array of `{step, evidence, skip?}`: a tool call (`<tool> <input as JSON>`) matches `evidence`, or the trace or reply matches `skip`; the summary shows one row per step. It writes per-run JSON, the stream-json traces, `aggregate-result.json` for `summarize.mjs` and `summary.md` into `<eval dir>/results/local-<ts>/` (or `--out`). It stops launching runs when the account's rate limit utilization reaches `--stop-at-utilization` (default 0.98), or when `--max-usd <n>` would be passed: before each run it adds the mean cost (agent + judge) of the finished runs, or the case's `estimate_usd` before the first one finishes, for that run and each run still in flight; the summary prints the total.

A `case.yaml` can add steps after the agent stops, before grading:

- `hidden_tests` (`dir`, `command`, optional `filter`): copies the case's test files over the result project, runs only them (`<command> <files> --maxWorkers=1 [-t <filter>] --reporter=json`) and puts the agent's own files back. A `regex` grader with `target: hidden_tests` reads the per-test result (`HIDDEN: PASS` or `FAIL`, one line per test).
- `ui_check` (`start`, `stop`, `restore`, `reset`, `scenario`, `id`, `drive`, `screenshot`, `final_steps`, `patch`, `files`, `env`, `drive_timeout_seconds`): the case describes the use case in words (`scenario`: the text, or a file in the case folder) and names no tool; the runner knows none. It applies `patch`, copies each `files` entry (`from` in the case folder, `to` in the act dir), runs `start` with the run's project, the act dir, a free app port and a free dev port in `JIG_*` variables (`JIG_RUN_DIR`, `JIG_ACT_DIR`, `JIG_CASE_DIR`, `JIG_APP_PORT`, `JIG_DEV_PORT`, `JIG_UI_ID`, `JIG_UI_SCENARIO` with the words), runs `drive` in the act dir, which follows `$JIG_UI_SCENARIO` in the running app with whatever app control the case provides (a script, or a model run with its own tool), then `screenshot` (optional), which prints the path of an image. It saves the verdict and a screenshot per attempt under `ui/<run>/`, then runs `stop`, `restore` and reverts the patch. `drive` ends with a line `DONE`, `FAIL: <where>` or `STALE: <where>` and exits 0 only on `DONE`; `<where>` is `replay <id>` (`id` names the scenario, default `scenario`) or `step <name>` for the check that decides. Only a FAIL in the scenario's own check or in a step listed in `final_steps` counts as the app failing; an earlier FAIL or STALE runs `reset` and drives once more. One app runs at a time, also with `-j`. An `llm` grader with `focus: ui` judges the verdict and the screenshots; it is skipped from the score when no attempt reached the final check. `--no-ui` skips the step.
- `context.base_link: <path>`: the runner scaffolds the base commit once per case and writes its path into that file of each run, so the case's CI script can drop errors the base already has.

`eval:prepare` installs the mini-project toolchain once into `evals/_toolchain/`. `--scaffold` runs each case's `scaffold.sh` (bash) on your machine; `run-local.mjs` passes it `JIG_EVALS_DIR`, so a scaffold can link a shared `node_modules` with `evals/link-modules.mjs` (a real directory of package junctions: caches such as `.vite` stay in the run). Drop `--case` for the full set; the cases ask for one run each.

## Benchmarks

Against your own project:

```text
node bench/hot-path.mjs <project-root> [--runs 200] [--file <relative path>]
node bench/stop-gate.mjs <project-root> [--files 1,5,20] [--runs 3]
node bench/false-positives.mjs <repo>
```

`hot-path.mjs` times `pre-edit` and `post-edit` hooks and reports p50, p95, max, peak RSS and CPU time of the jig process, and the machine CPU load during the runs (target: p95 < 300 ms, RSS < 150 MB). `stop-gate.mjs` plays a turn per run: `session-start`, `user-prompt-submit`, an exported const appended to N tracked `.ts` files (`.vue` with a non-setup `lang="ts"` script as a fallback) with a `post-edit` for each, then the timed `stop` hook. It reports wall time, peak RSS, jig CPU time, machine CPU (which includes tsc and ESLint) and the gate verdict, with the first run apart from the warm ones, and checks the target: stop < 20 s on 1, 5 and 20 files. It refuses files with uncommitted changes and restores their contents after each run and on Ctrl+C. `false-positives.mjs` runs the comment and suppression rules over every tracked `.ts` and `.vue` file as if it were newly added and prints each hit.
