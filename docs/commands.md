# Commands

Run as `node <plugin root>/bin/jig.mjs <command>`.

| Command | What it does |
| --- | --- |
| `check edit <file>` / `check stop` | findings for one file / the end-of-turn gate against HEAD |
| `build [--atoms-only] [--check]` | validates atoms, role templates and flows; without `--atoms-only`, writes the tool plan to `.jig/cache/plan.json` |
| `atom <name>` | prints an atom |
| `init [--update] [--json]` | discovery by the catalog: found tools, what to ask the user, a proposed `.jig/config.jsonc` (with `--update`, the current config plus what it does not name); writes nothing |
| `slot new [--slug <s>] [--branch <b>]` | creates a slot worktree with offset ports and its own `agent-view.config.json`, seeded from the main checkout |
| `slot show <N> <branch\|commit>` | checks the branch out detached in slot N (refuses on tracked changes) and runs the install command when a lock file changed |
| `slot ls [--json]` | slots and their ports |
| `slot rm <N> [--force]` | removes a slot's worktree; without `--force`, refuses on tracked changes |
| `worktree seed <dir>` | copies the main checkout's ignored files and recreates its ignored symlinks in another worktree; never overwrites tracked files |
| `worktree remove <dir>` | removes a linked worktree: unlinks its symlinks and junctions first (the targets stay), then `git worktree remove --force`; `slot rm` and `worktree sweep` remove the same way |
| `worktree sweep [--json] [--ask] [--yes <path\|slot>]...` | sorts every worktree but the main checkout into `hold-current`, `hold-locked`, `hold-wip`, `hold-open-mr`, `prunable`, `recent`, `safe`; removes only those confirmed at the `--ask` prompt or named by `--yes`, never a `hold-current`, `hold-locked` or `hold-wip` one |
| `review-plan [<base>] [--selector full\|quick\|auto\|<tokens>] [--spec] [--mode review\|pre-mr] [--mr] [--no-state] [--rereview] [--agent <id>] [--json] [-- <pathspec>...]` | the review layout for the diff against the base, or for the given paths only: counted lines, the diff command, the inline path or the finders, their models and the judge, and the step files that apply to the run. `--rereview` (a re-review's new range): under 600 counted lines one standard/high finder carries every angle and there is no deepening; from 600 lines the full layout. With finders it writes the diff once under `.jig/runs/review/diff-<hash>/` (parts of at most 1500 lines, each file whole, split into `code-*`, `tests-*` and `docs-*`, and an `index.txt` of line ranges) and prints it as `diff files:`, so subagents read files instead of running the diff again; each finder's `diff:` line lists only its parts: code for every finder, tests for angle 16, documents for angles 11 and 15 (`testPaths` in `.jig/review.jsonc` adds test globs) |
| `review-cycle queue\|state-path\|import-state\|base-check\|spec\|reconcile\|unresolved\|spec-hold\|withdraw\|verdict` | the deterministic half of the [review cycle](review-cycle.md): the filtered queue, the state path of a merge request, importing the old skills' state, the adapter's base-check and spec, the tally check, the count of unresolved threads without Nit and Pre-existing ones, the spec hold, withdrawing threads, the per-ref verdict; exit 3 when the forge or the adapter cannot answer |
| `review cost [<session>] [--project <dir>] [--record] [--json]` | estimated $ of a review session (Claude Code transcripts: the session's `subagents/`), per role and per merge request, with unit metrics: diff lines code/tests/docs, $ per 1000 diff lines, posted threads, $ per thread, cache hit ratio. Without `<session>`: the latest session of the project. An agent joins a merge request by `!<iid>` or `MR<iid>` in its spawn description, and a role by the description's first word. `--record` appends one line per run to `~/.jig/review-cost.jsonl` (`JIG_COST_LOG` overrides), each runner once. Prices: [user config](configuration.md#user-config) |
| `review state <state file>` | a review state in a few lines: shas, runs, the non-zero tally, one line per finding (status, severity, angle, `file:line`, thread, id, summary), without the comment bodies |
| `review cost --report [--by project\|week]` | the recorded runs per project, or per project and ISO week: runs, re-reviews, $, $ per 1000 diff lines, $ per thread over first runs |
| `pre-mr [<base>] [-- <pathspec>...]` | exit 0 when the branch's UI changes (in the given paths only) are proven or skipped with a level, else lists what is missing and exits 1 ([UI proof](ui-proof.md)) |
| `pre-mr proof "<command>"` / `pre-mr bug-bash "<result>"` | runs a proof command and records it when it exits 0 / records the bug-bash result |
| `skip-verify --level unit-test\|type-check\|none --why "<reason>"` | lets `pre-mr` pass with that level until the next edit |
| `task-status log <phase> <decision> [--why <text>] [--evidence <text>] [--result <text>]` | appends a row to the decision journal `.jig/runs/<branch>/task-status.tsv` |
| `task-status open [--lang en\|ru]` / `task-status path` | builds the HTML page from the journal and prints its path / prints the journal path |
| `tiers [--agent <id>] [--json]` | the models of each tier for the agent |
| `loop [--days 7]` | aggregates the journal into improvement candidates |
| `doctor` | diagnostics: Node, config, each catalog tool, agent-view setup, deny block, journal size, locks |
| `version` | plugin version |

`hook <name>` is the entry point for `hooks/hooks.json`, not for people.
