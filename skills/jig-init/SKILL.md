---
name: jig-init
description: "Set jig up for this project, or settle it after the project changed: discover tools by the jig catalog, ask the user only what code cannot know, write an explicit .jig/config.jsonc, set up the tools the user chose with their own commands, propose the personal UI driver commands, then run jig doctor. Use for /jig-init, or when session start says run jig init or jig init --update."
disable-model-invocation: true
argument-hint: "[--update]"
---

# jig init

At runtime jig reads only `.jig/config.jsonc` (in git) and `.jig/config.local.jsonc` (personal, outside git, laid over the shared file). A catalog tool or proof that the config does not name never runs. This skill writes that explicit config.

CLI: `node "<root>/bin/jig.mjs" <command>`. `<root>` is the plugin root: `${CLAUDE_PLUGIN_ROOT}` when the agent sets it, otherwise the directory two levels above this file. Schema of the config: `<root>/schema/config.schema.json`.

Read `<root>/atoms/questions.md` before the first question and follow it. Ask in your reply, as text; never through a blocking question tool.

## Procedure

1. Discover. Run `init` (or `init --update` when `.jig/config.jsonc` exists or the argument says so). It prints what the catalog found (marker configs, packages, binaries), the drift against the current config, the questions code cannot answer, and a proposed config. It writes nothing.
   Its `type check:` line names the project's type-check script; when it takes files, the proposal already holds `"tsc": false` and the `types` check: keep them, the project owns type checking and jig only calls its command.
2. Read the repo for the rest: `package.json` scripts, the README, CI files, workspace layout. A fact found there is not a question: the dev and install commands usually are in the scripts.
3. Ask what is left, one question block per choice, each with a recommendation:
   - the command that runs the app (`slots.dev`) and installs packages (`slots.install`), when the repo did not say and the config has no `slots`;
   - whether UI changes get proven in the running app, and with which app control tool when several are available;
   - whether a module-layer checker enforces the layers.
   Do not ask about the comment gate: it is on by default, and a project turns it off itself with `"rules": { "jig/comments": "off" }`. A tool the project has but the user wants off is written as `false`, so the next start does not report it as drift.
4. Write `.jig/config.jsonc` from the proposal and the answers: catalog tools and proofs as top-level keys by name (`"eslint": {}`, `"tsc": { "command": "vue-tsc" }`), `false` to turn one off, `level` `off|warn|error`, `command` to replace the catalog command, `ignoreRules` for rule globs to drop, and the project's own checks as `checks: [{ "name", "files", "on": "edit"|"stop", "run": "... {files}", "format" }]`. With `--update`, keep every setting the user wrote; add and remove only what the drift names. Personal differences go to `.jig/config.local.jsonc`, never to the shared file. jig runs no project git hooks; a check needed earlier than the commit gets its own `checks` entry.
5. A tool the user chose and the project has not set up yet (an app control tool, a module-layer checker): set it up with its own init command and its own docs, review what it generated against the project (for an app control tool, the app run command), then add its catalog key by name when the catalog has one.
6. A module-layer checker (for example stratum), when the user wants one:
   1. No config yet: run the checker's own init.
   2. The project already has a boundaries lint (for example `eslint-plugin-boundaries`): port its element types and rules into the checker's config following the checker's guide. Leave the old plugin installed and its config untouched; add its rule glob to `"eslint": { "ignoreRules": [...] }` so jig stops reporting it.
      The layers are the user's decision. Port on your own only a rule with a one-to-one translation. Everything else is a question, one at a time, with the lines it comes from and a recommendation: a layer or slice the config does not name, a rule with no one-to-one form, a folder that breaks the layering today (legacy code, a shared dump, a generated folder), and the project's existing suppressions or ignores. Legacy keeps the strict rule and goes to the baseline or a named override the user picks; never loosen a layer's rule to make legacy pass.
   3. Run the checker over the project. Violations that exist today go to its baseline.
   4. Show the user the diff of its config (and of the baseline size) before you go on.
   5. Add its catalog key.
7. UI driver, when the project has UI and a `ui` profile: look in the environment for an app control tool (see App control in `skills/jig/SKILL.md`). Found: propose `ui.driver` command templates for it, with the placeholders `{width} {height} {pointer} {theme} {locale} {state} {out} {target}`, show them to the user and write them to `.jig/config.local.jsonc` only after the user confirms (the tool is the person's, not the project's). None found: leave `ui.driver` empty; `jig ui prove --collect` is the path then. Also propose `ui.reference.fetch` (`{source} {out}`) when a design tool is available, the same way.
8. Verify. Run `doctor`. Every catalog entry is either running with its binary, `off in config`, or `not used`; fix any `warn` that says found, not in config, or binary not installed, and run `doctor` again.
9. Report: the config written, what each answer changed, what was set up, and the final `doctor` lines that are not `ok`.
