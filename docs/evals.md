# Evals and benchmarks

Rule fixtures run with the unit tests: `npm test`.

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

It runs `scaffold.sh` with Git Bash in a fresh temp dir, then the prompt with `--plugin-dir` (arm `with`) or without it (arm `without`; `evals/agent-flow` runs `with` only). Both arms skip your own setup: user settings, hooks, plugins, MCP servers, `CLAUDE.md` and auto-memory. Each run gets its own `TMPDIR`/`TEMP`/`TMP` and, when the scaffold leaves an `agent-view.config.json`, a free CDP port written into it, so parallel runs (`-j`) do not drive each other's browser; a literal `/tmp/...` path in a shell command stays shared. `regex` and `llm` graders (judge: `--judge-model` and `--judge-effort`, opus at high by default) score each run. A `flow` grader (run-local only) checks the steps its body lists as a JSON array of `{step, evidence, skip?}`: a tool call (`<tool> <input as JSON>`) matches `evidence`, or the trace or reply matches `skip`; the summary shows one row per step. It writes per-run JSON, the stream-json traces, `aggregate-result.json` for `summarize.mjs` and `summary.md` into `<eval dir>/results/local-<ts>/` (or `--out`). It stops launching runs when the account's rate limit utilization reaches `--stop-at-utilization` (default 0.98), or when `--max-usd <n>` would be passed: before each run it adds the mean cost (agent + judge) of the finished runs, or the case's `estimate_usd` before the first one finishes, for that run and each run still in flight; the summary prints the total.

A `case.yaml` can add steps after the agent stops, before grading:

- `hidden_tests` (`dir`, `command`, optional `filter`): copies the case's test files over the result project, runs only them (`<command> <files> --maxWorkers=1 [-t <filter>] --reporter=json`) and puts the agent's own files back. A `regex` grader with `target: hidden_tests` reads the per-test result (`HIDDEN: PASS` or `FAIL`, one line per test).
- `ui_check` (`start`, `stop`, `restore`, `reset`, `replay`, `final_steps`, `patch`, `acts`, `store`, `store_sections`, `env`): applies `patch`, runs `start` with the run's project, act dir and free CDP and dev ports in `JIG_*` variables, replays the `replay` use case with `agent-view act replay`, saves the verdict and a screenshot per attempt under `ui/<run>/`, then `stop`, `restore` and reverts the patch. Only a FAIL in the use case's own check or in a step listed in `final_steps` counts as the app failing; an earlier FAIL or STALE runs `reset` and replays once more. One app runs at a time, also with `-j`. An `llm` grader with `focus: ui` judges the verdict and the screenshots; it is skipped from the score when no attempt reached the final check. `--no-ui` skips the step.
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
