# Configuration

`.jig/config.jsonc` names what runs ([schema](../schema/config.schema.json)); `.jig/config.local.jsonc`, outside git, is laid over it: objects merge key by key, `checks` merge by name, any other value replaces the shared one. `/jig-init` writes the first one.

```jsonc
{
  "$schema": "https://raw.githubusercontent.com/PetukhovArt/jig/main/schema/config.schema.json",
  "rules": { "jig/comments": "off" },
  "tsc": { "command": "vue-tsc" },
  "eslint": { "ignoreRules": ["boundaries/*"] },
  "oxlint": false,
  "agent-view": {},
  "checks": [
    { "name": "i18n-keys", "files": ["src/**/*.vue", "src/**/*.ts"], "on": "stop", "run": "node scripts/check-i18n.mjs {files}" }
  ]
}
```

- `rules`: `jig/comments` and `jig/tests`, levels `off`, `warn`, `error` (default `error`); any level but `off` keeps the gate on.
- A catalog name (`oxlint`, `tsc`, `eslint`, `stratum`, `agent-view`) turns that tool on; `false` turns it off. Its settings: `level`, `command`, `ignoreRules`, `timeout`. A name outside the catalog is an unknown key. When each tool runs: [hooks](hooks.md#what-needs-project-configuration).
- `checks`: the project's own commands, run after an edit (`"on": "edit"`) or at the end of a turn (`"on": "stop"`) on the files matching `files` (a glob or a list). `run` starts with a command found in the project's `node_modules/.bin` (up to the git root), then on `PATH`, npm `.cmd` shims included; it needs the `{files}` token, which becomes one argument per file; `format` reads the output (`exit` by default: a non-zero exit is one finding; `jsonl`, or a tool name for its parser); `level` as for rules. Findings carry the rule `check/<name>`.
- `timeout` on a tool or a check: the seconds it may run at the end of a turn, 1 to 110 (defaults: eslint 30 plus 1 per file, tsc 60, stratum 15, a check 30). Every end-of-turn check shares 110 s; after-edit runs keep 5 s.
- `slots` and `worktree`: [below](#slots-and-worktrees).
- `reviewCycle`: `processAdapter` and `forge` for the [review cycle](review-cycle.md).

jig creates only `.jig/` in your project: `config.jsonc` goes to git, `config.local.jsonc`, `journal/`, `runs/` and `cache/` are ignored by `.jig/.gitignore`.

## User config

`~/.jig/config.jsonc` (`JIG_USER_CONFIG` overrides the path; [schema](../schema/user-config.schema.json)) holds what belongs to the user, not the project:

```jsonc
{
  "tiers": { "claude": { "deep": ["opus"], "standard": ["sonnet"], "fast": ["haiku"] } },
  "prices": { "opus": { "input": 5, "output": 25 } }
}
```

- `tiers`: the models of each tier per agent (`jig tiers`).
- `prices`: estimated US dollars per million tokens per model family, matched as a substring of the model id; replaces the built-in entry of that family (opus 5/25, sonnet 3/15, haiku 1/5). Cache writes cost ×1.25 of input (5-minute) or ×2 (1-hour), cache reads ×0.1. Used by `jig review cost`; every figure it prints is an estimate.

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

`worktree.depsPool`, when present, makes `jig slot new` and `jig slot show` take `node_modules` from the dependency pool instead of installing (`jig worktree deps`): the first worktree with a root `package-lock.json`, `npm-shrinkwrap.json` or `yarn.lock` installs, later ones with the same lock file, `package.json`, install command, OS, CPU architecture and Node major version get a hardlink copy; an installed checkout with that key fills a missing entry without an install. Hardlinked files are shared: a tool that edits a file under `node_modules` in place (patch-package, a native rebuild) changes it in every worktree on that entry, while a reinstall replaces files. `du` counts a hardlinked file in each tree. A pool entry under `.git/jig/deps/` (the git common dir, which IDE indexers, watchers and globs skip) can be deleted at any time; `jig worktree deps --prune` deletes those no checkout uses. Hardlinks need the pool and the worktree on one volume, else files are copied, and prune keeps such an entry, whose use it cannot tell. `after` runs in the worktree after a reuse, for what the install also makes outside `node_modules`, which the first install reports.

`slots.slotEnv` writes the slot number itself into an env file, for a dev script that derives its ports from it. A slot's `agent-view.config.json` takes the main checkout's `url` with a `ports` base moved to the slot's port ([slots](../skills/jig-slots/references/app-slots.md)).

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
