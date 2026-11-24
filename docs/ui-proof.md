# UI proof before the merge request

The [`mr`](../skills/jig/flows/mr.md) step runs `jig pre-mr [<base>] [-- <pathspec>...]`, which diffs the branch against its base. Paths after `--` (relative to the current directory, as in git) leave out uncommitted work that is not the task's; a scope with no changes is an error.

`jig pre-mr` runs nothing for the UI. It only checks that the branch has fresh receipts of the [`ui`](../skills/jig/flows/ui.md) flow, and for each missing one it names the command that creates it.

## Receipts

A receipt is a journal record bound to the state of the working tree. It counts until a file of the branch is changed after it. Only a `jig ui` command writes a receipt, and only on success; it cannot be written by hand.

jig does not know which files are UI. Whether the task touches the UI is the model's judgment, recorded with `jig ui scope ui|none "<why>"` (receipt `ui-scope`, required of every branch with changes). With `none` no UI receipt is required, and the reason stays in the journal for the reviewer. With `ui` the receipts below are required.

- `ui-reference` is written by `jig ui reference add` or `jig ui reference none` at step 2 of flow `ui`: the decision about references is made. Always required with `ui`. Without it the other `jig ui` commands do not run.
- `ui-reuse` is written by `jig ui reuse` when no raw element stands on the changed lines. Required when `ui.components.map` names at least one element.
- `ui-mockup` is written by `jig ui mockup <n>` when it reports no blocking finding. Required for every reference in `.jig/ui/<branch>/references.json` that has a node tree.
- `ui-matrix` is written by `jig ui prove` when every matrix combination has a result and no audit error stands. Required when proof on a running app is possible (`ui.driver`, or `--collect`).

`jig skip-verify --level unit-test|type-check|none --why "<reason>"` waives only the receipts that need a running app (`ui-matrix`). `ui-reference`, `ui-reuse` and `ui-mockup` read the code and the references, so they stay required. The level goes to the journal.

## break-it

break-it checks behavior, not looks, and `jig pre-mr` does not require it. In hitl `jig pre-mr` recommends it with a time estimate and the agent asks the user; in afk the agent runs it. Its result: `jig pre-mr break-it "<bugs found and fixed, what could not be tested>"`.

## `jig ui mockup`

Compares the node tree of reference `<n>` from `references.json` with the code: colors the code lacks, labels the reference lacks or that repeat, typography by role (`--role`), a swapped frame. jig takes the tree in its own schema (node, text, fill, font). What produces it (a design tool's MCP or API, the DOM of a Claude design, a manual export) is the model's call; only skills name tools.

jig reads tokens only from its own table in the open W3C Design Tokens (DTCG) JSON format: the name, the value per theme and the names code uses to refer to the token (`--bg-main`, `colors.primary`, `theme.palette.primary.main`). A token's use is looked up in the code by those names, literally. The model builds the table any way it likes, or the project command `ui.tokens.command` prints it. jig does not parse CSS, Vuetify, MUI or WPF. The project's other conventions (component prefixes, the language of labels) are not built into jig either.

A design is not always right: it may have been updated before the code, or the task may want something else that its owner forgot to say. So the agent may stop and ask the user about a difference. First the agent fixes the obvious misses. About the rest it asks once, as a list: per finding what the reference shows, what the code shows and its own guess (the design is outdated, or the task requires it). In afk the agent decides by its guess and marks the deviation "decided by the agent". An accepted deviation is written to `.jig/ui/<branch>/deviations.md` with the reason, and reaches the evidence page and the merge request description.

## `jig ui prove`

Every combination of [`jig ui matrix`](configuration.md#ui-profile) (target × width × theme × locale) needs a result:

1. The app is brought to the combination: width, height, pointer type, theme, locale.
2. Each state of `--states` (or the current screen) is captured: a screenshot and a layout audit (overflow, clipping, overlap, out of bounds). For a canvas the audit walks the scene tree.
3. A theme or locale that switches only by a relaunch gives a skipped combination with a line saying what to relaunch with; the combination runs once the app is started so.

What brings the app to a combination and captures the result is the executor's business: an app control tool, a browser DevTools protocol client, computer use. jig knows only its own result format: files in `.jig/ui/<branch>/<target>-<width>-<theme>[-<locale>]/` and `result.json`. A result reaches jig in one of two ways:

- The `ui.driver` section in `.jig/config.local.jsonc` (a personal file outside git: the tool belongs to the person, not the project) holds the executor's command templates with the placeholders `{width}`, `{height}`, `{pointer}`, `{theme}`, `{locale}`, `{state}`, `{out}` and `{target}`. `jig ui prove` runs them itself and reads the result in jig's format. The skill `jig-init` fills it: the model proposes commands for the tool it found in the environment and the user confirms.
- Without `ui.driver` the agent captures the result itself with any tool and puts it into the combination folders, and `jig ui prove --collect` checks it: every combination is present, the screenshot width equals the combination's width, the files were created after the current working tree state, and `result.json` matches the schema.

Exit 1 while an audit error, a state that could not be reproduced or (with `--exact`) a pixel difference stands; warnings do not fail the run.

Every image reference in `references.json` is compared with the combinations it covers (`--covers`; without it, with the combinations of the same width in the first theme). The image is a PNG (8-bit RGB or RGBA); its path may hold `{target}`, `{width}`, `{theme}`, `{locale}` and `{state}` so each combination has its own. The comparison is per pixel (a difference above 12 of 255 in any channel counts; with `--exact` every one). It is evidence, not a gate, unless `--exact` is set for a reference that is an existing implementation.

The `ui-matrix` receipt is written when no audit error stands and every combination has a result for the current working tree. Results of earlier runs on the same tree are kept, so a partial run (`--target`, a combination that needs a relaunch) is completed by the next one.

## Evidence page

`.jig/ui/<branch>/index.html` is one file with inline CSS and no network, readable in a light and a dark system theme, with images by relative path. For every combination and state it shows the reference, the result and the diff map side by side, the audit table (rule, severity, target, detail, a link to the screenshot with the findings marked), then the targets to check by hand, the notes (skipped combinations, a reference that could not be obtained) and the accepted deviations from `.jig/ui/<branch>/deviations.md` when the file exists. The folder is git-ignored; the key images go into the merge request description as attachments, Before (the reference) and After (the result), not as committed images.
