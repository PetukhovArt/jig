---
name: jig-init
description: "Set jig up for this project, or settle it after the project changed: discover tools by the jig catalog, ask the user only what code cannot know, write an explicit .jig/config.jsonc, set up agent-view and stratum with their own commands, then run jig doctor. Use for /jig-init, or when session start says run jig init or jig init --update."
disable-model-invocation: true
argument-hint: "[--update]"
---

# jig init

At runtime jig reads only `.jig/config.jsonc` (in git) and `.jig/config.local.jsonc` (personal, outside git, laid over the shared file). A catalog tool or proof that the config does not name never runs. This skill writes that explicit config.

CLI: `node <root>/bin/jig.mjs <command>`. `<root>` is the plugin root: `${CLAUDE_PLUGIN_ROOT}` when the agent sets it, otherwise the directory two levels above this file. Schema of the config: `<root>/schema/config.schema.json`.

Read `<root>/atoms/questions.md` before the first question and follow it. Ask in your reply, as text; never through a blocking question tool.

## Procedure

1. Discover. Run `init` (or `init --update` when `.jig/config.jsonc` exists or the argument says so). It prints what the catalog found (marker configs, packages, binaries), the drift against the current config, the questions code cannot answer, and a proposed config. It writes nothing.
2. Read the repo for the rest: `package.json` scripts, the README, CI files, workspace layout. A fact found there is not a question: the dev and install commands usually are in the scripts.
3. Ask what is left, one question block per choice, each with a recommendation:
   - the command that runs the app (`slots.dev`) and installs packages (`slots.install`), when the repo did not say;
   - whether UI changes get proven in the running app with agent-view;
   - whether stratum checks the module layers.
   Do not ask about the comment gate: it is on by default, and a project turns it off itself with `"rules": { "jig/comments": "off" }`. A tool the project has but the user wants off is written as `false`, so the next start does not report it as drift.
4. Write `.jig/config.jsonc` from the proposal and the answers: catalog tools and proofs as top-level keys by name (`"eslint": {}`, `"tsc": { "command": "vue-tsc" }`), `false` to turn one off, `level` `off|warn|error`, `command` to replace the catalog command, `ignoreRules` for rule globs to drop, and the project's own checks as `checks: [{ "name", "files", "on": "edit"|"stop", "run": "... {files}", "format" }]`. With `--update`, keep every setting the user wrote; add and remove only what the drift names. Personal differences go to `.jig/config.local.jsonc`, never to the shared file. jig runs no project git hooks; a check needed earlier than the commit gets its own `checks` entry.
5. agent-view, when the user wants it and the project has no `agent-view.config.json`: run `agent-view init` in the project root, review the `launch` field against the app run command, then add `"agent-view": {}`.
6. stratum, when the user wants it:
   1. No `stratum.config.jsonc`: run `stratum-lint init`.
   2. `eslint-plugin-boundaries` is in package.json: port its element types and rules into `stratum.config.jsonc` following the stratum guide (`docs/custom-rules.md`, the section translating an eslint-plugin-boundaries setup: layers with `depends_on`, `slices`, `entry_points`, `import-policy`, `overrides`, `restricted-calls`). Leave the plugin installed and its ESLint config untouched; add `"eslint": { "ignoreRules": ["boundaries/*"] }` so jig stops reporting it.
   3. Run `stratum-lint` over the project. Violations that exist today go to `stratum-lint baseline`.
   4. Show the user the diff of `stratum.config.jsonc` (and of the baseline size) before you go on.
   5. Add `"stratum": {}`.
7. Verify. Run `doctor`. Every catalog entry is either running with its binary, `off in config`, or `not used`; fix any `warn` that says found, not in config, or binary not installed, and run `doctor` again.
8. Report: the config written, what each answer changed, what was set up, and the final `doctor` lines that are not `ok`.
