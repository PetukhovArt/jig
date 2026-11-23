# UI proof before the merge request

The [`mr`](../skills/jig/flows/mr.md) step runs `jig pre-mr [<base>] [-- <pathspec>...]`, which diffs the branch against its base; paths after `--` (relative to the current directory, as in git) leave uncommitted work that is not the task's out, and a scope with no changes is an error.

UI proof is asked for only when `.jig/config.jsonc` names a proof tool (`"agent-view": {}`); without one, `jig pre-mr` exits 0 with `Verification level: no UI proof tool configured`. With one, the agent asks the user whether to run the proof (afk: runs it).

A UI file needs proof kinds: `behavior` (the use case still works) and `look` (what the user sees). For agent-view, components and markup (`.vue`, `.tsx`, `.jsx`, `.svelte`, `.html`, not tests) need both, styles (`.css`, `.scss`, `.less`) need `look`.

`jig pre-mr proof "<command>"` runs the command and records the proof when it exits 0: only `agent-view act replay` proves `behavior`, only `agent-view screenshot` or `snap` proves `look`; other commands are refused. A proof counts when no UI file it covers changed after it. A branch that touches UI also needs a break-it record: `jig pre-mr break-it "<bugs found and fixed, what could not be tested>"`. Without them `jig pre-mr` lists what is missing and exits 1.

When the proof cannot run, `jig skip-verify --level unit-test|type-check|none --why "<reason>"` lets `jig pre-mr` pass until the next edit; the level goes to the journal and into the merge request description.

## With a `ui` profile

When `.jig/config.jsonc` has a [`ui`](configuration.md#ui-profile) section and the branch changes UI files (markup, styles or files matching `ui.components.files`, tests excluded), `jig pre-mr` also asks for these proofs. Each is a journal record bound to the working tree, so it counts until one of the UI files it covers is edited afterwards:

| proof | recorded by | asked when |
| --- | --- | --- |
| `ui-reuse` | `jig ui reuse`, when it finds no raw element on changed lines | `ui.components.map` names at least one element |
| `ui-matrix` | `jig ui prove`, when every matrix combination was driven and no audit error stands | an agent-view proof is configured and the matrix has an `auto` combination |
| `ui-mockup` | `jig ui mockup`, when it reports no blocking finding | the branch declared a Figma reference: `.jig/ui/<branch>/reference` holds `figma:<url>`, written by `jig ui mockup --figma <url>` or `jig ui prove --reference figma:<url>` |

A gap prints the command to run. `jig pre-mr proof` takes none of them: the `jig ui` commands record their own proof, and only when they pass. A branch whose only gaps are the static ones (no agent-view proof configured) is not asked for a break-it record. `jig skip-verify` waives only the proofs that need a running app (agent-view and `ui-matrix`): `ui-reuse` and `ui-mockup` read the code and the export, so they stay required after it.

## `jig ui prove`

`jig ui prove` needs agent-view configured (`agent-view.config.json` in the project or above it) and the app running; without them it exits 2 and says why. For each combination of [`jig ui matrix`](configuration.md#ui-profile), in order:

1. `agent-view emulate --reset` with the target's width, height and pointer, and the color scheme when the theme switches by `media`.
2. The theme and locale switch: `act` runs `agent-view act replay <use case>`. A `launch` switch cannot change at runtime: the combination is skipped with the line that names what to relaunch with, and runs when the app was launched with it and `--launched <name>` says so.
3. Each state of `--states` (an agent-view use case, replayed) or, without it, the current screen: `agent-view audit --json --shot`, plus `audit --scene` when `agent-view.config.json` has `webgl.engine: app-hook` (unless `--no-scene`), and `agent-view screenshot --out`. `--root` limits the layout audit to one test id or selector.

At the end it resets the emulation. Files go to `.jig/ui/<branch>/<target>-<width>-<theme>[-<locale>]/`, with `result.json` and `index.html` beside them. Exit 1 while a layout or scene audit error, a state whose replay failed or (with `--exact`) a pixel difference stands; warnings never fail it.

`--reference figma:<url>` fetches the frame as a PNG through the Figma images endpoint (`JIG_FIGMA_API_KEY`, else `FIGMA_API_KEY`; without a key the run goes on with no comparison and says so) and declares the Figma reference of the branch; `--reference image:<path>` takes a PNG (8-bit RGB or RGBA), whose path may hold `{target}`, `{width}`, `{theme}`, `{locale}` and `{state}` for one image per combination. A single reference is compared with the combinations as wide as it is, in the first listed theme. The comparison is a pixel diff over the screenshot (a difference above 12 of 255 in any channel counts; `--exact` counts every one) and is evidence, not a gate, unless `--exact` is given for a reference that is an existing implementation.

The ui-matrix proof is recorded when no audit error stands and every matrix combination has a result for the current working tree; results of earlier runs on the same tree are kept, so a partial run (`--target`, a launch-switched combination) completes the proof with the next run.

## Evidence page

`.jig/ui/<branch>/index.html` is a single file with inline CSS, no network, readable in a light and a dark system theme, with images by relative path. Per combination and state it shows the reference, the result and the diff map side by side, the audit table (rule, severity, target, detail, a link to the shot with the findings drawn on it), the scene audit, then the targets to check by hand, the notes (skipped combinations, a reference that could not be fetched) and the accepted deviations from `.jig/ui/<branch>/deviations.md` when that file exists. The folder is git-ignored; the merge request gets key images as uploads and a table, never committed images.
