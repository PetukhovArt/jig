# Configuration

`.jig/config.jsonc` names what runs ([schema](../schema/config.schema.json)); `.jig/config.local.jsonc`, outside git, is laid over it: objects merge key by key, `checks` merge by name, any other value replaces the shared one. `/jig-init` writes the first one.

```jsonc
{
  "$schema": "https://raw.githubusercontent.com/PetukhovArt/jig/main/schema/config.schema.json",
  "rules": { "jig/comments": "off" },
  "tsc": { "command": "vue-tsc" },
  "eslint": { "ignoreRules": ["boundaries/*"] },
  "oxlint": false,
  "checks": [
    { "name": "i18n-keys", "files": ["src/**/*.vue", "src/**/*.ts"], "on": "stop", "run": "node scripts/check-i18n.mjs {files}" }
  ]
}
```

- `rules`: `jig/comments` and `jig/tests`, levels `off`, `warn`, `error` (default `error`); any level but `off` keeps the gate on. `"jig/comments": "off"` turns the comment gate off; suppressions stay denied.
- A catalog name (`oxlint`, `tsc`, `eslint`, `stratum`) turns that tool on; `false` turns it off. Its settings: `level`, `command`, `ignoreRules`, `timeout`. A name outside the catalog is an unknown key. When each tool runs: [hooks](hooks.md#what-needs-project-configuration).
- `checks`: the project's own commands, run after an edit (`"on": "edit"`) or at the end of a turn (`"on": "stop"`) on the files matching `files` (a glob or a list). `run` starts with a command found in the project's `node_modules/.bin` (up to the git root), then on `PATH`, npm `.cmd` shims included; it needs the `{files}` token, which becomes one argument per file; `format` reads the output (`exit` by default: a non-zero exit is one finding; `jsonl`, or a tool name for its parser); `level` as for rules. Findings carry the rule `check/<name>`.
- `timeout` on a tool or a check: the seconds it may run at the end of a turn, 1 to 110 (defaults: eslint 30 plus 1 per file, tsc 60, stratum 15, a check 30). Every end-of-turn check shares 110 s; after-edit runs keep 5 s.
- `slots` and `worktree`: [below](#slots-and-worktrees).
- `reviewCycle`: `processAdapter` and `forge` for the [review cycle](review-cycle.md).
- `ui`: the project's UI profile for `jig ui`, [below](#ui-profile).

jig creates only `.jig/` in your project: `config.jsonc` goes to git, `config.local.jsonc`, `journal/`, `runs/`, `cache/` and `ui/` are ignored by `.jig/.gitignore`.

## User config

`~/.jig/config.jsonc` (`JIG_USER_CONFIG` overrides the path; [schema](../schema/user-config.schema.json)) holds what belongs to the user, not the project:

```jsonc
{
  "tiers": { "claude": { "deep": ["opus"], "standard": ["sonnet"], "fast": ["haiku"] } },
  "prices": { "opus": { "input": 5, "output": 25 } }
}
```

- `tiers`: the models of each tier per agent (`jig tiers`), for example `"codex": { "deep": ["gpt-5.6-terra"] }` when your Codex account lists other models (`codex debug models`). `JIG_AGENT` names the agent when its environment variables do not.
- `prices`: estimated US dollars per million tokens per model family, matched as a substring of the model id; replaces the built-in entry of that family (opus 5/25, sonnet 3/15, haiku 1/5). Cache writes cost ×1.25 of input (5-minute) or ×2 (1-hour), cache reads ×0.1. Used by `jig review cost` and by the cost estimate of `jig review-plan`; every figure they print is an estimate.

## Slots and worktrees

Slots need a `slots` section; `worktreesDir` is required. The `worktree` section tunes seeding: `seedExclude` skips ignored paths, `copyFiles` adds files inside ignored folders:

```jsonc
{
  "slots": {
    "worktreesDir": "..",
    "install": "npm ci",
    "ports": { "VITE_PORT": { "base": 5173, "step": 10 } },
    "cdp": { "base": 9222, "step": 1 },
    "slotEnv": { "key": "SLOT", "target": ".env" }
  },
  "worktree": { "seedExclude": ["coverage"], "depsPool": { "after": "npm run build -w packages/shared" } }
}
```

`worktree.depsPool`, when present, makes `jig slot new` and `jig slot show` take `node_modules` from the dependency pool instead of installing (`jig worktree deps`): the first worktree with a root `package-lock.json`, `npm-shrinkwrap.json` or `yarn.lock` installs, later ones with the same lock file, `package.json`, install command, OS, CPU architecture and Node major version get a hardlink copy; an installed checkout with that key fills a missing entry without an install. Hardlinked files are shared: a tool that edits a file under `node_modules` in place (patch-package, a native rebuild) changes it in every worktree on that entry, while a reinstall replaces files. `du` counts a hardlinked file in each tree. A pool entry under `.git/jig/deps/` (the git common dir, which IDE indexers, watchers and globs skip) can be deleted at any time; `jig worktree deps --prune` deletes those no checkout uses. Hardlinks need the pool and the worktree on one volume, else files are copied, and prune keeps such an entry, whose use it cannot tell. `after` runs in the worktree after a reuse, for what the install also makes outside `node_modules`, which the first install reports. It runs on every branch a worktree is on, so it must tolerate a branch that lacks a step: `npm run --if-present <script>`, not `npm run <script>`.

A gitignored lock file (a project whose CI regenerates it) is an output of the install, not its input: the key covers every tracked `package.json` instead, a miss runs the resolving command (`npm install`, `yarn install`) instead of the frozen one, and each entry keeps the lock file it was installed with and writes it into the worktree on reuse. Such an entry keeps what the install resolved: a dist-tag that moved on the registry later reaches it only through `jig worktree deps <dir> --refresh` or another install, so commit the lock file when you can. `slots.install`, when set, is the install command in both cases, so for such a project make it a resolving one (`npm install --prefer-offline --no-audit --no-fund`). With `worktree.depsPool` the hooks also name each linked worktree that has no `node_modules` of its own ([hooks](hooks.md)).

`slots.slotEnv` writes the slot number itself into an env file, for a dev script that derives its ports from it. A slot's `agent-view.config.json` takes the main checkout's `url` with a `ports` base moved to the slot's port ([slots](../skills/jig-slots/references/app-slots.md)).

## UI profile

The `ui` section says what a UI change is proven on and which components it must reuse. `jig init` proposes it from code signals; the user confirms it, since a code signal cannot know which theme switch or which locale the project means. The signals: the runtime from `tauri` / `electron` dependencies (a `capacitor` or `react-native` stack adds a native target proven by hand); desktop widths `[1280, 1920]`; a `phone` target (`[390]`, `input: coarse`) only with a responsive signal (a `max-width` or `min-width` media query below 768px, `pointer: coarse`, a `viewport` or `responsive` module), and for a Tauri or Electron shell only with `pointer: coarse`; themes from `.dark` / `.light` classes, `[data-theme]`, `prefers-color-scheme` and Vuetify, MUI or PrimeVue theme configs, switched by `media` when the app follows `prefers-color-scheme` and else by a `TODO` act the user fills in; locales from i18n bundles (two to six), longest average text first, each with a `TODO` act; `components.dirs` from the common shared-UI folders, `components.map` from wrapper names found there (`Button`, `UiButton`, `TextField`, `Input`, `Select`, `Textarea`) or the UI library's own component. A project without UI signals gets no `ui` key; an existing `ui` key is left as it is.

```jsonc
"ui": {
  "targets": [
    { "name": "desktop", "runtime": "tauri", "widths": [1280, 1920], "height": 900, "minWidth": 1024, "input": "fine" },
    { "name": "phone", "runtime": "browser", "widths": [390], "height": 844, "input": "coarse" },
    { "name": "ios", "runtime": "native", "proof": "manual" }
  ],
  "themes": [
    { "name": "light", "switch": { "media": "light" } },
    { "name": "dark", "switch": { "act": "settings/theme-dark" } }
  ],
  "locales": { "list": [{ "name": "ru", "switch": { "launch": "LANG=ru" } }, { "name": "en", "switch": { "act": "settings/lang-en" } }], "check": "one" },
  "components": {
    "dirs": ["src/shared/ui"],
    "map": { "button": "Button (@/shared/ui/buttons)", "input": "TextField", "select": "Select" }
  },
  "tokens": { "files": ["design/tokens.json"] }
}
```

Personal keys, in `.jig/config.local.jsonc` (the tool belongs to the person, not the project):

```jsonc
"ui": {
  "driver": {
    "prepare": "<command> --width {width} --height {height} --pointer {pointer} --theme {theme} --locale {locale}",
    "capture": "<command> --state {state} --target {target} --out {out}",
    "reset": "<command> --reset"
  },
  "reference": { "fetch": "<command> {source} {out}" }
}
```

- `targets` and `themes` are required, everything else is optional; names are unique within a list. A target has a `runtime` (`electron`, `tauri`, `browser`, `native`), `widths` in CSS px (required unless the runtime is `native`; a width below `minWidth` is an error), `height`, `minWidth`, `input` (`fine` or `coarse`, the pointer to emulate) and `proof`: `auto` (default) or `manual`. A `native` target is always `manual`, and an explicit `auto` on it is an error: jig cannot drive it, so `jig ui matrix` lists it apart for the user to prove.
- `switch` is exactly one of `media` (an emulated `prefers-color-scheme` value), `act` (a use case from the project's behavior catalog, replayed by the app control tool) or `launch` (a string the flow passes to the app launch). It is required for every entry when a list has more than one; a locale switches only by `act` or `launch`.
- `locales.check`: `one` (default) proves only the first listed locale, `all` proves each. `jig init` orders the list by longest texts first, so the first one is the likeliest to overflow. A task that touches texts asks for all (`jig ui matrix --locales all`).
- `components.dirs` holds the project's shared components, where raw elements are fine. `components.map` names for each raw element (a tag) the component to use instead: a project wrapper, or a library component where the project uses the library directly (`"button": "v-btn"`).
- `ui.tokens` names where the table is: `files` (files, folders or globs) holding jig's token table in the W3C Design Tokens (DTCG) JSON format: the name, the value per theme and the names code uses to refer to the token. jig reads nothing else (not CSS, Vuetify, MUI or WPF). Or `command`: a project command that prints the table. The model can also build the table itself. `jig ui mockup` reads the table.
- `ui.driver` (personal, `.jig/config.local.jsonc`) holds the command templates `jig ui prove` runs to bring the app to a combination and capture it. Placeholders: `{width}`, `{height}`, `{pointer}`, `{theme}`, `{locale}`, `{state}`, `{out}`, `{target}`. Without it the agent captures the combinations itself and runs `jig ui prove --collect`. `/jig-init` proposes the commands for the app control tool it finds and writes them after the user confirms.
- `ui.reference.fetch` (personal, `.jig/config.local.jsonc`) is a command template that gets a reference from its source: placeholders `{source}` and `{out}`. When set, jig calls it for `jig ui reference attach`; without it the model obtains the PNG and the node tree itself.
- The `ui` section also decides what `jig pre-mr` asks for and what `jig ui prove` drives: [UI proof](ui-proof.md#receipts). The `act` switches of `themes` and `locales` are use cases that `jig ui prove` replays; a `launch` switch is proven only when the app was launched with it (`--launched`).

## Guard the config files

jig does not guard config files itself. A plugin cannot write permission rules into your project, so add this deny block to `.claude/settings.json`; `jig doctor` warns when it is incomplete. Claude Code applies an `Edit` rule to every built-in tool that edits files, `Write` included, and warns that a `Write(...)` rule never matches, so the block has only `Edit` rules:

```json
{
  "permissions": {
    "deny": [
      "Edit(.jig/config.jsonc)",
      "Edit(eslint.config.*)",
      "Edit(tsconfig*.json)",
      "Edit(.oxlintrc.json)",
      "Edit(stratum.config.jsonc)",
      "Edit(.github/workflows/**)",
      "Edit(.gitlab-ci.yml)",
      "Edit(.husky/**)"
    ]
  }
}
```
