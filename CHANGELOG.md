# jig

## 0.3.0

### Minor Changes

- [`ee2e3ca`](https://github.com/PetukhovArt/jig/commit/ee2e3ca783c559db5269e7f8ec825a0d4f3de27d) Thanks [@PetukhovArt](https://github.com/PetukhovArt)! - The task-status page takes answers again and opens itself when a run ends.

  - A click on an open question opens its answer box; drafts survive a reload, and `Copy answers` puts them on the clipboard as `<question>` then `→ <answer>`, ready for the chat.
  - `jig task-status open` opens the page in the default browser (`--no-browser` or `CI` set: build only); afk-mode, metric-climb and custom-flow run it before their reply.

### Patch Changes

- [`d5940dd`](https://github.com/PetukhovArt/jig/commit/d5940dda4b123039fd487646cba3c9122b798684) Thanks [@PetukhovArt](https://github.com/PetukhovArt)! - Agnostic gaps from the pre-release audit ([#17](https://github.com/PetukhovArt/jig/issues/17)):

  - The project root comes from `JIG_PROJECT_DIR` under any agent, then the variable the agent's adapter names (Claude Code: `CLAUDE_PROJECT_DIR`), then the git top level.
  - `jig review cost` says it reads Claude Code transcripts only when it finds no session.
  - `jig doctor` suggests setting agent-view up only in a project with markup or style files.
  - Review step examples name `<deep model>`, `<standard model>` and `<model A> → judge <model B>` instead of Claude model names.
  - The slot references name the agent's shell and file-write tools instead of Claude Code's, launch detached with `nohup` on macOS, which has no `setsid`, and give the PowerShell form of the Windows launch.
  - `jig-video` finds agent-view through `AGENT_VIEW_JS`, the global npm root or the `agent-view` command on `PATH`, so nvm-windows and volta installs work.
  - `jig doctor` warns when `PATH` has no `node` (or one older than 20), which the hooks run bare; `docs/hooks.md` explains the macOS Dock and nvm case.
  - `evals/run-local.mjs` starts an npm-installed `claude.cmd` on Windows through node, as `resolveBin` does.

- [`5bc519b`](https://github.com/PetukhovArt/jig/commit/5bc519bdff608213444de38631b41cbae844980d) Thanks [@PetukhovArt](https://github.com/PetukhovArt)! - `jig init` finds a marker config kept out of git (`.git/info/exclude` or `.gitignore`, outside ignored folders), so a locally excluded `stratum.config.jsonc` with a global `stratum-lint` reads as configured, and it no longer asks for `slots.dev` and `slots.install` when the config already has a `slots` section. ([#7](https://github.com/PetukhovArt/jig/issues/7))

- [`3158f9c`](https://github.com/PetukhovArt/jig/commit/3158f9c227f55b2b1c183a47698216b629737585) Thanks [@PetukhovArt](https://github.com/PetukhovArt)! - Skill snippets no longer need bash. `jig review rules [<base>]` prints the rules indexes on the walk up from the changed files, the standard documents and the architecture documents (paths with spaces included), replacing the `xargs`/`while read` walk and the `grep` searches; `jig review-plan --state` replaces the hash and per-file patch loops of a re-review. `mermaid-ascii` reads a file, forge bodies are written with the agent's file-write tool with the PowerShell form given, the CLI path is quoted (`node "<root>/bin/jig.mjs"`), and `docs/agents.md` says what remains POSIX shell. ([#16](https://github.com/PetukhovArt/jig/issues/16))

- [`7689c62`](https://github.com/PetukhovArt/jig/commit/7689c6244a0bcef24fc6928820e6a193cb1d06ae) Thanks [@PetukhovArt](https://github.com/PetukhovArt)! - A tool or check that times out is ended with its whole process tree (`taskkill /T` on Windows, the process group elsewhere), and the run settles shortly after the tool exits even when a grandchild still holds its output, so the stop hook reports the timeout at once instead of hanging. ([#15](https://github.com/PetukhovArt/jig/issues/15))

- [`6ae8a7c`](https://github.com/PetukhovArt/jig/commit/6ae8a7c7911cfb865a67b32937d608a14c1f1a75) Thanks [@PetukhovArt](https://github.com/PetukhovArt)! - Re-reviews in a review cycle cost what their new work costs. `jig review-plan <base> --rereview --state <path>` takes the scope from per-file patches against the base, so a base merged into the branch or a force-push counts only the branch's own changes, and prints a `re-review scope:` line; the cycle runs it before spawning and forks a runner only for an inline re-review. The poster always posts the state's whole postable set, whatever replies its brief lists, and `jig review state` prints that set as a `postable:` line the cycle checks the poster's report against. ([#19](https://github.com/PetukhovArt/jig/issues/19))

- [`8bde7d4`](https://github.com/PetukhovArt/jig/commit/8bde7d440f1c782ef3af7ea8165d2b87a6ccaf59) Thanks [@PetukhovArt](https://github.com/PetukhovArt)! - A direct review is cheaper and fully counted. `jig review cost` reads the session's own transcript: its turns from a `jig-review` invocation to the next human prompt count as the `runner` of the merge request, so $ per 1000 lines and $ per thread compare with a review cycle's. A review whose plan has finders runs in one review-runner subagent instead of the session that asked for it (`jig review-plan` prints a `runner:` line), and the runner reads no state, posting doc or later step before forking its finders, so forks inherit only the review's context. ([#18](https://github.com/PetukhovArt/jig/issues/18))

- [`5665d14`](https://github.com/PetukhovArt/jig/commit/5665d14c026bb85c222fc6b07a8937edab0d7066) Thanks [@PetukhovArt](https://github.com/PetukhovArt)! - `jig slot new` writes the slot's `agent-view.config.json` with the main checkout's `url` moved to the slot: a local port that a `ports` entry starts at becomes the slot's port, another local port is left out with a warning instead of pointing at slot 0. A new `slots.slotEnv` (`{ "key": "SLOT", "target": ".env" }`) writes the slot number itself into an env file, so a dev script that derives its ports from it starts the slot's own instance from the unchanged `dev` or `launch`. ([#8](https://github.com/PetukhovArt/jig/issues/8))

- [`9505d9b`](https://github.com/PetukhovArt/jig/commit/9505d9be9a67b40e3c565b0c8ed16015ac05725f) Thanks [@PetukhovArt](https://github.com/PetukhovArt)! - The end-of-turn gate no longer passes when a check did not finish. A tool or check that times out, crashes or runs out of the shared budget blocks the turn once with `gate/incomplete`, naming the tool, and `jig check stop` prints an `incomplete:` line and exits 3 instead of `clean`. Each tool and check takes a `timeout` in seconds, and eslint's default grows by a second per file. ([#6](https://github.com/PetukhovArt/jig/issues/6))

## 0.2.0

### Minor Changes

- [`9e08a70`](https://github.com/PetukhovArt/jig/commit/9e08a7034521002754713a75f16110bf8d9779ca) Thanks [@PetukhovArt](https://github.com/PetukhovArt)! - Explicit config, gates before the edit, UI proof before the merge request.

  Breaking:

  - No tool runs until `.jig/config.jsonc` names it (`"eslint": {}`, `"tsc": { "command": "vue-tsc" }`, `false` to turn one off). `rules` no longer takes `gate/*` levels. Run `/jig-init` or `jig init` to get the proposal; `.jig/config.local.jsonc`, outside git, is laid over the shared config.
  - Removed the pre-bash, post-read and post-bash hooks, protected paths, `jig allow-no-verify` and the rules `jig/protected-paths`, `jig/no-verify`, `jig/suppressions` and `jig/verify-fact`. Guard config files with the permissions deny block that `jig doctor` prints; drop the removed rules from your config.
  - New comments and new test cases are denied at pre-edit, once with their atom; a retry of the same call passes. The comment gate is on by default; turn it off with `"jig/comments": "off"` and the test gate with `"jig/tests": "off"`. Suppression directives are always denied.
  - The end of a turn no longer asks for UI proof. `jig pre-mr` gates the merge request instead: `jig pre-mr proof "<command>"`, `jig pre-mr bug-bash "<result>"`, or `jig skip-verify --level unit-test|type-check|none --why "<reason>"`.
  - `jig dash` is replaced by the user-invoked skill `jig-task-status` and `jig task-status log|open|path`.
  - `jig slot sweep` is replaced by `jig worktree sweep`, which removes a worktree only when you confirm it.
  - The `review` flow is replaced by the `jig-review` skill (modes `review` and `pre-mr`).
  - Atoms are no longer delivered after an edit by `paths`; `/jig` reads them from the atom index in `skills/jig/SKILL.md`. `skills/jig/references/atoms.md` is gone.

  Added:

  - `jig init [--update]` and the `jig-init` skill; own checks in `checks[]`.
  - `jig slot show <N> <branch>`, `jig worktree seed <dir>` and `jig worktree sweep`.
  - `jig review-plan` and the `jig-review` skill.
  - Flows `custom-flow`, `metric-climb`, `diagnose` and `eval`.
  - Skills `jig-grill` and `jig-prune-comments`.

- [`b956b88`](https://github.com/PetukhovArt/jig/commit/b956b8876ccc9a731d6d5c37dcd85c953643319d) Thanks [@PetukhovArt](https://github.com/PetukhovArt)! - Initial release.

- [`abc9318`](https://github.com/PetukhovArt/jig/commit/abc9318353ae8c989240c44a76668fd02fda22a0) Thanks [@PetukhovArt](https://github.com/PetukhovArt)! - C# in the comment and test gates; test files found by path or by content.

  - `.cs` files get the comment gate: `//`, `///` and `/* */` comments are found past regular, verbatim, interpolated and raw string literals and char literals; preprocessor directives are not comments, `// <auto-generated>` is a tool directive.
  - `#pragma warning disable`, `#nullable disable` and `// ReSharper disable` (any language) are denied every time, like `eslint-disable`; `// ReSharper restore` is a tool directive.
  - A new `[Fact]`, `[Theory]`, `[Test]`, `[TestCase]`, `[TestCaseSource]`, `[TestMethod]` or `[DataTestMethod]` method is a new test case for the test gate; a new `[InlineData]` or `[TestCase]` row on an existing method is not.
  - A C# file is a test file when a folder or the file name is `test`, `tests`, `spec`, `__tests__` or `_tests_`, or starts or ends with `Test`/`Tests` as a word (`TestsBackend/`, `Api.Tests/`, `OrderTests.cs`); `Attestation.cs` is not. JavaScript and TypeScript keep `*.test.*`, `*.spec.*` and `__tests__/`.
  - A file outside those paths is a test file when it holds a test of its language: a `[Fact]`-style method in C#, a `describe('…')`, `it('…')` or `test('…')` call at the start of a statement in JavaScript or TypeScript. The test gate, `jig pre-mr` and `jig review-plan` read the file for it.

- [`d1866d8`](https://github.com/PetukhovArt/jig/commit/d1866d8aaeb1212d83612a8b6608ce643f81a935) Thanks [@PetukhovArt](https://github.com/PetukhovArt)! - The written diff and the state read cost less.

  - Diff parts keep one `=== <path>` line per file (with `new`, `renamed from`, `binary`) instead of `diff --git`, `index`, `---` and `+++`; a deleted file is one line with its line count; lock files, minified files, source maps and snapshots are not written, and `index.txt` names them.
  - `jig review state <path>` prints a state in a few lines without the comment bodies; steps read it instead of the JSON.

- [`dec086f`](https://github.com/PetukhovArt/jig/commit/dec086f9b6755743b4d1ef62320eaecba7b91a5b) Thanks [@PetukhovArt](https://github.com/PetukhovArt)! - `jig review cost` estimates what a review cost and records it, so passes and projects compare by unit metrics.

  - Reads a Claude Code session's subagent transcripts: dollars per role (runner, finder, judge, deepener, outcome, poster) and per merge request, with the merge request's diff lines (code/tests/docs), $ per 1000 lines, posted threads, $ per thread and the cache hit ratio.
  - `--record` appends one line per run to `~/.jig/review-cost.jsonl`; `--report [--by project|week]` prints the recorded runs.
  - Prices are estimates from `prices` in `~/.jig/config.jsonc`, else built-in list prices. `/jig-review-cycle` records each pass and puts a cost line in its summary; spawn descriptions carry `<Role> … !<iid>`.

- [`d39a850`](https://github.com/PetukhovArt/jig/commit/d39a85090685a4fc35f2f0fe1df15ddd22ff27ac) Thanks [@PetukhovArt](https://github.com/PetukhovArt)! - A merge request whose posted Important still stands goes back to the developer instead of hanging in review. A re-review after a commit that left the defect in place answers once in its thread (`` after `<sha>` the defect stands: <line> ``), and its outcome is `returned`; `jig review-cycle standing <mr>` counts such findings. `jig review-cycle queue` prints `outcome=` on every `SKIP` line: `unchanged` and `stale` with a standing Important are `returned`, the rest `held`. A developer reply no longer lets a merge request be skipped as stale. An answer under the FYI note, or a new commit, rechecks the optional items, and the note ticks the done ones.

- [`386303a`](https://github.com/PetukhovArt/jig/commit/386303a0f8cf4288d80471ed302c85243b839d86) Thanks [@PetukhovArt](https://github.com/PetukhovArt)! - `/jig-review-cycle`: one pass over every merge request awaiting your review, with `jig review-cycle` for the queue and its filter, the tally check, the unresolved count, the spec hold, withdrawal and the per-ref verdict through a team process adapter (`reviewCycle.processAdapter`). The `jig-review` state file now lives under the main checkout, so a review in a linked worktree shares it.

- [`4d9e15f`](https://github.com/PetukhovArt/jig/commit/4d9e15f9260a8d88489b2c5e7bfecc8f6d9ce6cc) Thanks [@PetukhovArt](https://github.com/PetukhovArt)! - `jig-review` writes its deepening proposal to the state file (`deepening`, the latest one per merge request), and posting puts it in the FYI note as its own section, "Deepening: a proposal, not a finding". It stays out of threads, the tally and the outcome check. Before, a review cycle's runner reported it and the poster found nothing to post.

- [`871fa87`](https://github.com/PetukhovArt/jig/commit/871fa87137bf2a2d4be5530b43e8e2fc06da41c1) Thanks [@PetukhovArt](https://github.com/PetukhovArt)! - `jig review-plan` splits the written diff by audience, so a finder reads only what its angles judge.

  - Parts are `code-*`, `tests-*` and `docs-*`; each finder's `diff:` line lists its parts: code for every finder (code is a graph, never cut by angle), tests only for angle 16, documents only for angles 11 and 15.
  - `_tests_/` directories count as tests; `testPaths` in `.jig/review.jsonc` adds test globs.

- [`b7e749f`](https://github.com/PetukhovArt/jig/commit/b7e749f2b55670204bd81c22b7e9d4e6bd48794d) Thanks [@PetukhovArt](https://github.com/PetukhovArt)! - `jig-review` reads fewer documents and narrower code windows.

  - Input documents are the rules indexes closest to the changed files (`AGENTS.md`, `CLAUDE.md`), the task's spec or PRD, and the standards. A README, a directory overview, an ADR index or a glossary map is not read whole.
  - ADRs: only the ones the diff changes or a rules index links. Glossaries: the changed hunks, and a grep of each new term in the owning glossary, never the whole file.
  - Finders read the diff parts listed under their `diff:` only, locate with a numbered search with context, then read at most ~60 lines; no `cat` of whole files, no `sed` ranges of hundreds of lines.

- [`8f6ef38`](https://github.com/PetukhovArt/jig/commit/8f6ef383ba6d01b3f1910e20cc189286cd3e15fe) Thanks [@PetukhovArt](https://github.com/PetukhovArt)! - A re-review is the outcome check plus one finder on the new range.

  - `jig review-plan --rereview`: under 600 counted lines one standard/high finder carries every angle and there is no deepening; from 600 lines the full layout. A re-review of seven fix commits ran five finders and a deepener and cost almost a first run.

- [`2f0c33e`](https://github.com/PetukhovArt/jig/commit/2f0c33e8147d899ebffdc81fe2c97446e72175c8) Thanks [@PetukhovArt](https://github.com/PetukhovArt)! - A review never runs tests, builds or installs: a claim only a test would settle is not proven. `/jig-review-cycle` seeds its worktrees without dependencies and no longer passes a `tests:` line to the runner. `jig worktree seed --link-deps` is removed: the review cycle was its only user.

- [`d5f56df`](https://github.com/PetukhovArt/jig/commit/d5f56df059fb05014463a9f0075cad5c32431c0b) Thanks [@PetukhovArt](https://github.com/PetukhovArt)! - `jig review-plan` reviews only the given paths: `review-plan [<base>] -- <pathspec>...`.

  - The paths scope `LINES`, the finder count, the layout, the diff shape and the untracked count; the `lines:` line names the scope.
  - A new `diff:` line prints the command for the reviewed diff, paths included; finders, judges and the inline path read the diff through it.
  - `jig-review` in mode `pre-mr` passes the task's paths when the working tree holds uncommitted work that is not the task's.
  - `jig pre-mr [<base>] -- <pathspec>...` takes the same scope: UI files outside the paths need no proof.
  - Paths after `--` are relative to the current directory, as in git. A path outside the repository, or a scope with no changes, is an error.

- [`0f4cedf`](https://github.com/PetukhovArt/jig/commit/0f4cedfbf76c4b7d84d1a50ca2cf91c21b2ca0c7) Thanks [@PetukhovArt](https://github.com/PetukhovArt)! - The review runner runs on the deep tier at medium effort, and its finders run on the same model, so they still fork from it.

  - On the standard tier the runner skipped steps and read step files its plan did not list. The `lean` and re-review finders move to the deep tier with it: a fork needs the spawner's model, and a fork inherits its effort.
  - `/jig-review-cycle` reads the engine files of a re-review once per pass and forks a runner per re-review with a `prepared:` line; a first run, or a fork that returns `needs fan-out`, gets a fresh runner.
  - A re-review skips the full-diff `jig review-plan` in step 01 and plans on its new range in step 09: the full-diff plan listed finder and verify steps the run never took.

- [`f61ad16`](https://github.com/PetukhovArt/jig/commit/f61ad16206ab227c6d9b1e5fcbd91174baa388cd) Thanks [@PetukhovArt](https://github.com/PetukhovArt)! - The review runner runs on the standard tier at high effort, so the standard finders it spawns fork from it.

  - A fork inherits the spawner's model and effort; the runner was deep/medium, so every sonnet finder was spawned fresh and read every diff part itself. Now standard/high finders fork and start from the runner's prompt cache; judge, deepener and outcome check stay deep and fresh.
  - When no finder forks, the orchestrator reads the diff index and only the ranges it judges, not every part.
  - `/jig-review-cycle` spawns each role on its template's tier and effort, never the session's model.

- [`edeebd6`](https://github.com/PetukhovArt/jig/commit/edeebd65da3f7ef495dff925cba985a45ad9a108) Thanks [@PetukhovArt](https://github.com/PetukhovArt)! - `jig-review` reads its shared context once and a failed run continues instead of restarting.

  - `jig review-plan` writes the diff once when the layout has finders: parts of at most 1500 lines under `.jig/runs/review/diff-<hash>/`, each file whole, with an `index.txt` of line ranges, printed as `diff files:` (`diffFiles` in `--json`). Finders read the parts and judges their files' ranges; nobody runs `git diff` on the reviewed range again.
  - The orchestrator reads the code around the diff once and passes it as an `already read` list. Where the agent can fork (Claude Code), a subagent on the orchestrator's own model is forked and starts from the prompt cache; others are spawned fresh with byte-identical briefs.
  - Finders, deepener and judges run in the foreground, so their reports reach the agent that spawned them, never the review cycle's session.
  - With state on, finished reports are kept in a checkpoint next to the state file. A retry of the same head and diff reuses them; `/jig-review-cycle` messages a failed runner to go on, or starts one with `retry: reuse the checkpoint`, instead of a second full fan-out.

- [`11a3125`](https://github.com/PetukhovArt/jig/commit/11a31259cb51b068acab20264baccfe024809d25) Thanks [@PetukhovArt](https://github.com/PetukhovArt)! - Cheaper reviews of small diffs.

  - `jig-review` on a diff with `N = 1` reviews inline in the session: no finder subagent, and one judge on another model only when an Important candidate survives. Without a selector such a diff runs `quick`; `--selector full` runs every angle.
  - `jig review-plan` takes `--mode review|pre-mr`, `--mr` and `--no-state`, prints the absolute paths of each reader's angle files and atoms, and ends with the step files that apply to the run.
  - State files are kept only in mode `review` with a merge request; mode `pre-mr` and a review of a bare branch write nothing under `.jig/runs/review/`.
  - Judges read the gate files of their cluster's classes (`skills/jig-review/gates/`) instead of the whole verify step.

- [`d77a104`](https://github.com/PetukhovArt/jig/commit/d77a104c6c49d3c7a142098ed4867aa1b8367b0b) Thanks [@PetukhovArt](https://github.com/PetukhovArt)! - One definition of the spec of a task, for `jig-review`, the process adapter's `spec` op and `jig review-cycle spec`: the task's own text in its tracker (with subtasks and comments), or a spec or PRD document the task or the merge request links. A project document that only describes the touched area is context, never the spec, so angle 15 and the spec hold no longer judge a diff against it.

  - A task the merge request names (an issue reference or a tracker key in its title, description, branch or commits) is always read; `discover.tracker` is gone from `.jig/review.jsonc`, `discover.spec: false` still turns the search off.
  - A spec read from a tracker is kept in a file next to the state file; the `spec` tail of the output and the review runner's new `spec:` line name it, and the review cycle runs its spec hold against that file.

- [`ebe4ef8`](https://github.com/PetukhovArt/jig/commit/ebe4ef837276635cbe017d9003be83cd34959837) Thanks [@PetukhovArt](https://github.com/PetukhovArt)! - The end-of-turn gate checks only the session's own changes.

  - A file another session or the IDE changed in the same checkout during the turn is no longer checked or blocking; the journal gets a `foreign-change` record.
  - Files changed by the session's own `Bash` or `PowerShell` commands still count: new `pre-shell` and `post-shell` hooks diff `git status` around each call. A background command or one with no post event counts until the stop.
  - An agent adapter without shell events keeps the previous behaviour: every file that changed during the turn.
  - A project without `.jig/config.jsonc` takes no snapshots around shell commands.

### Patch Changes

- [`e0aa27e`](https://github.com/PetukhovArt/jig/commit/e0aa27e62e5f50b8341ed7d4535f037bfd1c3f0e) Thanks [@PetukhovArt](https://github.com/PetukhovArt)! - Agnostic fixes before the first release. A custom check or tool command resolves from the project's `node_modules/.bin` before `PATH`, and Node's own `npm.cmd` and `npx.cmd` resolve on Windows, so `npx …` and locally installed checkers no longer fail with ENOENT. Skills name the plugin root as `${CLAUDE_PLUGIN_ROOT}` or the directory two levels above the skill, so they run under agents that do not set it; `jig-task-status` ships the Codex policy that keeps it user-only, and the build rejects a user-only skill without one. `jig worktree sweep` picks `gh` or `glab` by `reviewCycle.forge` or the GitHub host, the same rule as the review cycle. `jig doctor` shows the Claude Code deny block only in Claude Code or a plain terminal, and recommends `Edit` rules only: Claude Code applies them to `Write` and warns that a `Write` rule never matches.

  The cached tool plan is rebuilt when the plugin bundle changes, not only when the version or a project file does, so a fix that ships without a version bump takes effect at the next session start.

- [`a685d42`](https://github.com/PetukhovArt/jig/commit/a685d42da429cd4b9d617ef83a71174e0984a0bc) Thanks [@PetukhovArt](https://github.com/PetukhovArt)! - `jig review-cycle queue` without a configured process adapter prints `WARNING built-in adapter: <forge> reviewer queue, no tracker spec, verdicts not recorded; …` as its first line (and `warning` in `--json`), and the `/jig-review-cycle` summary repeats it, so a pass on the forge's reviewer queue instead of the team's is visible before anything is posted.

- [`7674aff`](https://github.com/PetukhovArt/jig/commit/7674affd96f78641548719bf4c270999e5147a4c) Thanks [@PetukhovArt](https://github.com/PetukhovArt)! - The review cycle docs say how to compare pass costs and why plugins no review role uses should be off where cycles run unattended.
