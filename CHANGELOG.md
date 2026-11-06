# jig

## 0.4.0

### Minor Changes

- [`46e684f`](https://github.com/PetukhovArt/jig/commit/46e684f3cc1f5be73cd65a2e00e315fb073e2847) Thanks [@PetukhovArt](https://github.com/PetukhovArt)! - `jig tiers` maps Codex models by default and takes the agent from `JIG_AGENT` before its environment variables; `CODEX_THREAD_ID` marks a Codex shell.

- [`48a4033`](https://github.com/PetukhovArt/jig/commit/48a4033e252752d265dc4235e5e7cd8039b358cd) Thanks [@PetukhovArt](https://github.com/PetukhovArt)! - New flow `deepening`: the `deepener` scans a scope you name (paths, a merge request, a branch, a scan card) for module deepenings, the candidates go to an HTML report, and the one you pick is grilled, designed with `module-design` and built with `refactoring`.

- [`c2859bb`](https://github.com/PetukhovArt/jig/commit/c2859bb77b590608f7cc7eed0b7ceb25d20ef32c) Thanks [@PetukhovArt](https://github.com/PetukhovArt)! - Dependency pool: a gitignored lock file is treated as an install output. The key covers every tracked `package.json` instead, a miss runs the resolving command (`npm install`, `yarn install`), and each entry keeps its lock file and writes it into the worktree on reuse. One key holds versions: a reuse takes the newest, and a checkout with a newer lock file becomes a new version first. `jig slot show` fills the slot from the pool when a tracked `package.json` changed. With `worktree.depsPool`, the hooks name each linked worktree a shell command created, or the agent works in, without its own `node_modules`, once per agent, with the `jig worktree seed` and `jig worktree deps` commands for it. ([#27](https://github.com/PetukhovArt/jig/issues/27))

- [`a979b21`](https://github.com/PetukhovArt/jig/commit/a979b210c607232a9f8159d8a4a46b6f1f666caf) Thanks [@PetukhovArt](https://github.com/PetukhovArt)! - Dependency pool: the key covers `package.json` along with the lock file, so a branch with the main checkout's copied lock file no longer gets the main checkout's entry. `jig worktree deps` takes the main checkout too; on a miss it pools a fresh install of another checkout with the same key instead of installing; `--save` makes a checkout's current `node_modules` the entry without an install; `--prune [--dry-run]` removes the entries no checkout uses. ([#27](https://github.com/PetukhovArt/jig/issues/27))

- [`0435ab1`](https://github.com/PetukhovArt/jig/commit/0435ab1e22d678a8d065186b35ddcf3dbd6e1a70) Thanks [@PetukhovArt](https://github.com/PetukhovArt)! - Dependency pool: `jig worktree deps <dir>`, and `jig slot new` / `jig slot show` with `worktree.depsPool` in `.jig/config.jsonc`, install `node_modules` (npm, yarn) once per root lock file and give every later worktree with the same lock file a hardlink copy of it from `.git/jig/deps`, instead of a full install per worktree. `worktree.depsPool.after` reruns what the install also builds outside `node_modules`. ([#27](https://github.com/PetukhovArt/jig/issues/27))

- [`a6bb89c`](https://github.com/PetukhovArt/jig/commit/a6bb89c467a908f34adc88e068cdf0616f533b6a) Thanks [@PetukhovArt](https://github.com/PetukhovArt)! - Finders split the diff's files instead of the angles: `jig review-plan` partitions the files by imports and shared directories into N groups, gives each finder one partition with every selected angle and only that partition's diff parts, and prints a one-line cost estimate of the finders. A finder follows a link out of its partition (an import, a store key, an event, IPC, a request) in the code itself and names it with the other side's `file:line` in `cross:`; the judge reads both sides. A `tiers.flow` key in `.jig/review.jsonc` is accepted and ignored.

- [`6a89a03`](https://github.com/PetukhovArt/jig/commit/6a89a03968671d577f4ed2f94946b4325d100174) Thanks [@PetukhovArt](https://github.com/PetukhovArt)! - `partitions` in `.jig/review.jsonc` sets how a review splits the diff, as text (for example one finder per feature module whatever its size). With it `jig review-plan` computes no count by lines: it prints the text, the changed code files with their lines and the imports between them, the review runner groups the files by the text, and `jig review-plan --partition <name>=<paths>` writes the diff parts and finders for those groups, rejecting a code file in no group or in two. Every finder gets the text in its brief. Without the key the split by lines is unchanged.

- [`1a61547`](https://github.com/PetukhovArt/jig/commit/1a615478c24f1c798447cc6fbdebb5cc37b42a74) Thanks [@PetukhovArt](https://github.com/PetukhovArt)! - `jig-review`: the project config adds its own angles, `angles.<name>` with an angle `file` and a finder `kind` (`behavior` or `conventions`); any angle, numbered or named, turns off with `enabled: false`, and with angle 16 off the test files are not read.

- [`a03249c`](https://github.com/PetukhovArt/jig/commit/a03249c6eb1ae273f658505d8d668959a0463f2d) Thanks [@PetukhovArt](https://github.com/PetukhovArt)! - `jig-review` runs one path at every diff size: two fresh finders per partition, `behavior` (angles 1–5, 8, 12, 14, 15; deep/high) and `conventions` (angles 6, 7, 9–11, 13, 16, 17; standard/high, reads the routed rules and glossaries). The `inline` and `fanout` layouts are removed (`auto` = `lean`; `solo` keeps the two kinds); project `tiers` take the keys `behavior` and `conventions`. The cost estimate is calibrated on a measured 10,263-line run. Without state the run's files go to the OS temp dir; each plan prints a `run:` id and its checkpoints are reused only by a retry of the same run. Verify's lean section is self-contained, a missing project severity section passes `gates/severity.md` by path, and the output gets a `runner disagrees:` line.

- [`e123e26`](https://github.com/PetukhovArt/jig/commit/e123e269ba4a864be8211ee9ca3bd8ad931d30bf) Thanks [@PetukhovArt](https://github.com/PetukhovArt)! - `jig-review` hunts what the user meets, not the shape of code: angles 6 (reuse), 7 (simplification), 9 (fix altitude), 10 (conventions and smells), 11 (documents), 13 (architecture), 16 (tests) and 17 (comments) are removed, and with them the default `conventions` finder, the `layer`, `spread`, `smell` and `false-guarantee` classes, blocking findings and the optional simplifications of the FYI note. The project's checks own those rules; a project that still wants one reviewed adds its own angle of kind `conventions`, which is the only thing a `conventions` finder now carries. A removed angle number in `.jig/review.jsonc` is accepted and changes nothing; a removed selector token (`architecture`, `tests`, `comments` and the rest) is an error. The rare gate no longer asks whether the fix adds code: a bug a tester using the feature as intended does not meet is a known risk, except data loss, security, a broken invariant and what the project's severity sections name. `jig review rules` no longer prints `architecture` lines.

  Every spec deviation of a review goes into one thread, item by item, grouped as missing, done differently and unrequested: `jig review route` routes the lead as a `thread` (or a `discussion`) with the heaviest severity and every other spec finding as a `spec-item` of it; a later run adds its spec findings to the open thread by one reply, and the thread resolves when every item is closed.

- [`4d83895`](https://github.com/PetukhovArt/jig/commit/4d838952ac9ec4fe99e762a6887fff583e90e269) Thanks [@PetukhovArt](https://github.com/PetukhovArt)! - `jig slot show` records the session that showed last as the slot's owner (in the slot's git dir) and refuses a slot another owner showed to in the last 2 hours, or one a plain `git checkout` moved; the same session is never refused. The owner is `--owner <id>`, the agent's session variable, or the first non-shell ancestor process. `--force` takes the slot over; new `jig slot release <n>` clears the owner.

- [`3c3eb82`](https://github.com/PetukhovArt/jig/commit/3c3eb82a44d7f215c30e607f4a2b0acf48df62d2) Thanks [@PetukhovArt](https://github.com/PetukhovArt)! - `jig task-status plan "<step>" ...` declares a run's steps up front as todo. On the page a step with `skip`/`skipped`/`superseded`/`dropped`/`cancelled` is struck and left out of the count, and steps an earlier run left unclosed stay marked with their run. The page is still built once, by `task-status open` at the end of the run or on request.

### Patch Changes

- [`650f8c1`](https://github.com/PetukhovArt/jig/commit/650f8c1d489aa5aea3f332dfba1145f77aabb42a) Thanks [@PetukhovArt](https://github.com/PetukhovArt)! - `jig review cost` puts the subagents of a runner subagent (finders, deepener, judge) under that runner, so one review of a merge request is one row and one record, and counts the history a fork copies from its parent once instead of once per fork.

- [`0127873`](https://github.com/PetukhovArt/jig/commit/0127873c487d122710b5519c9c91241e54ec9baa) Thanks [@PetukhovArt](https://github.com/PetukhovArt)! - `jig review cost` takes a subagent's role from the first word of its spawn description only, so "Verify and bug bash !12" is `other`, not `judge`.

- [`1c5db4e`](https://github.com/PetukhovArt/jig/commit/1c5db4ec9e94c57d1137f803fa2ecc0a77161fb9) Thanks [@PetukhovArt](https://github.com/PetukhovArt)! - The deepening proposal is written in the comment language, posts in the FYI note as one labelled line per field (module, what, effect, blast radius) with code names in backticks, and carries a before and after Mermaid diagram from the imports the deepener read.

- [`5060940`](https://github.com/PetukhovArt/jig/commit/5060940da723f3a650960cfa8b3df42323148030) Thanks [@PetukhovArt](https://github.com/PetukhovArt)! - `jig review-cycle head <mr>` compares the forge head with the state's `last_reviewed_sha`; the review checks the head with it before verify (lean layout included) and at the end, the review runner returns a `head:` line, posting refuses a moved head unless acknowledged, and the review cycle runs a follow-up round on the increment first, so a push during a review no longer goes unnoticed ([#28](https://github.com/PetukhovArt/jig/issues/28)).

- [`3640566`](https://github.com/PetukhovArt/jig/commit/3640566f99b9a8c27258c2fd15ce3f0aa2d423af) Thanks [@PetukhovArt](https://github.com/PetukhovArt)! - `jig-review` posting routes a finding on an unchanged line of a diff file, and an `Important` outside the diff without `caused_by`, to a resolvable discussion with the chip first and `file:line` after the body, not to the FYI note. The FYI note holds only `Nit` and `Pre-existing` findings outside the diff, and the confirmation flags an `Important` or a diff file routed there. ([#22](https://github.com/PetukhovArt/jig/issues/22))

- [`d57e6dd`](https://github.com/PetukhovArt/jig/commit/d57e6ddb52cea14f1eaffcae65e2254722e3afbc) Thanks [@PetukhovArt](https://github.com/PetukhovArt)! - `jig review-plan` leaves lock files (`package-lock.json`, `Cargo.lock`, `uv.lock` and the rest of jig's lock file list) out of the counted lines, so a regenerated lock file no longer picks the layout or the number of finders; the diff parts skip the same list. ([#23](https://github.com/PetukhovArt/jig/issues/23))

- [`ed79c6c`](https://github.com/PetukhovArt/jig/commit/ed79c6c7c9cc6a4ecba03acb35a28e1bb1a8f56a) Thanks [@PetukhovArt](https://github.com/PetukhovArt)! - The merge request description lists only what was done: the Verification block opens with the verification level, the `Bug-bash:` line appears only when bug-bash ran, and the pre-MR review verdict stays in the agent's reply and the task-status log.

- [`44109bc`](https://github.com/PetukhovArt/jig/commit/44109bca8cffa106506179e6a084e916d667997a) Thanks [@PetukhovArt](https://github.com/PetukhovArt)! - Atom `small-steps` starts with the step every later step leans on (the data shape, the reproduction, the repeat script). Atom `root-causes`: a premise shared by two failed fixes that turns out false is removed from the code, not patched a third time.

- [`2ef7e88`](https://github.com/PetukhovArt/jig/commit/2ef7e88cafc3e0ab042105d34ef2d00e3e938a21) Thanks [@PetukhovArt](https://github.com/PetukhovArt)! - `jig review-cycle queue` prints `SKIP unchanged` for a new head whose diff against the target hashes to the state's `diff_hash`, such as a rebase that moved no patch, instead of sending it to a runner that finds `re-review scope: unchanged`. It fetches the target and the head into the main checkout; a fetch that fails leaves the merge request actionable. ([#21](https://github.com/PetukhovArt/jig/issues/21))

- [`2cfffb5`](https://github.com/PetukhovArt/jig/commit/2cfffb533e40f5f99b3250bda287c61c416155b6) Thanks [@PetukhovArt](https://github.com/PetukhovArt)! - `jig review-plan --rereview --state` follows renames: a file moved since the last review is compared with the reviewed patch of its old path, so a rename commit counts only the lines that differ instead of the whole file, the `re-review scope:` line names each rename and `diff:` shows the move as a rename ([#29](https://github.com/PetukhovArt/jig/issues/29)).

- [`d002b4e`](https://github.com/PetukhovArt/jig/commit/d002b4efb88a59a0dd1f5bfbfef0bc205dd21082) Thanks [@PetukhovArt](https://github.com/PetukhovArt)! - `jig review-plan` and `jig review rules` in a linked worktree read `.jig/review.jsonc` from the main checkout when the branch does not track one, so a review worktree created before the config, or seeded with an old copy, no longer plans with the defaults (angles the project turned off came back).

- [`2ed1cd0`](https://github.com/PetukhovArt/jig/commit/2ed1cd0c48e0120ea04e134417c57159c9f0d8ec) Thanks [@PetukhovArt](https://github.com/PetukhovArt)! - `jig review-cycle merge <mr> <keep> <duplicate>... --note <file>` merges duplicate threads: each duplicate of yours gets the note and is resolved, and its finding becomes `no_change_needed` with its thread kept. A state with a status outside the schema now names every bad finding, its status and the allowed set, and says the file was edited outside jig ([#25](https://github.com/PetukhovArt/jig/issues/25)).

- [`59517d1`](https://github.com/PetukhovArt/jig/commit/59517d10941d1cc44a967ba1ba3262e6d77221c4) Thanks [@PetukhovArt](https://github.com/PetukhovArt)! - `jig-review` spawns every finder fresh on the tier and effort `jig review-plan` prints, never as a fork of the review runner: a fork inherits the runner's medium effort, and a partition finder needs nothing of the runner's context. The plan marks each finder `fresh, never a fork`.

- [`b01b349`](https://github.com/PetukhovArt/jig/commit/b01b3494a7951a63ac438bbca2365c23d85d4216) Thanks [@PetukhovArt](https://github.com/PetukhovArt)! - `jig review rules` and `jig review-plan` route the project's glossaries: the root `GLOSSARY.md` to every finder, a context glossary that `GLOSSARY-MAP.md` lists to the partitions under its directory, printed in each finder's `rules:` line. A name in the diff that a glossary lists to avoid (`_Avoid_`, `Avoid:`, `не использовать`) is a naming finding with the glossary line quoted.

- [`4f18765`](https://github.com/PetukhovArt/jig/commit/4f18765352cb6eb0db399221108de08bbe717fd7) Thanks [@PetukhovArt](https://github.com/PetukhovArt)! - `jig review route <state> <base_sha> <head_sha>` prints the posting route of every postable finding, so posting no longer decides it by hand: an `optional` item or the deepening in the FYI note is no longer flagged as a routing error, and a finding left without a thread after posting blocks the merge request in the review cycle instead of passing silently ([#26](https://github.com/PetukhovArt/jig/issues/26)).

- [`7f68423`](https://github.com/PetukhovArt/jig/commit/7f68423b3e2480665ae30f4573b33418e3c48367) Thanks [@PetukhovArt](https://github.com/PetukhovArt)! - `jig review rules` lists the standards under `docs/standards/` again (the default `discover.exclude` dropped all of `docs/`), scopes a standard to the directory of the index that links it, and `jig review-plan` prints per finder under `rules:` the indexes and standards whose scope holds a file of its partition.

- [`f8c4915`](https://github.com/PetukhovArt/jig/commit/f8c4915533033185c147edfc12e8b7f10cdc2490) Thanks [@PetukhovArt](https://github.com/PetukhovArt)! - `jig worktree seed` copies jig's project config (`.jig/config.jsonc`, `.jig/config.local.jsonc`, `.jig/review.jsonc`) when `.jig/` is ignored in full, so a review worktree plans with the project's `review.jsonc` instead of the defaults.

- [`c8da6d2`](https://github.com/PetukhovArt/jig/commit/c8da6d2260df719bfa6495928f2264085dc3540b) Thanks [@PetukhovArt](https://github.com/PetukhovArt)! - The end-of-turn gate skips files inside another linked worktree under the project, such as a background subagent's `.claude/worktrees/agent-<id>/`, so its unfinished edits no longer block the main session's turn ([#30](https://github.com/PetukhovArt/jig/issues/30)).

- [`6f552fa`](https://github.com/PetukhovArt/jig/commit/6f552fa521c42e0ec8d51e24217734b6c506fa2a) Thanks [@PetukhovArt](https://github.com/PetukhovArt)! - One rule in the `jig` skill says where the app runs: a single agent working in turn runs the dev server and the verify in its own checkout; a slot is taken only when another agent writes in that checkout at the same time. Flows and `jig-slots` point to it instead of always sending the UI proof and bug bash to a slot.

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
