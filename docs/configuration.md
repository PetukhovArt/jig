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
- A catalog name (`oxlint`, `tsc`, `eslint`, `stratum`, `agent-view`) turns that tool on; `false` turns it off. Its settings: `level`, `command`, `ignoreRules`. A name outside the catalog is an unknown key. When each tool runs: [hooks](hooks.md#what-needs-project-configuration).
- `checks`: the project's own commands, run after an edit (`"on": "edit"`) or at the end of a turn (`"on": "stop"`) on the files matching `files` (a glob or a list). `run` needs the `{files}` token, which becomes one argument per file; `format` reads the output (`exit` by default: a non-zero exit is one finding; `jsonl`, or a tool name for its parser); `level` as for rules. Findings carry the rule `check/<name>`.
- `slots` and `worktree`: [below](#slots-and-worktrees).
- `reviewCycle`: `processAdapter` and `forge` for the [review cycle](review-cycle.md).

jig creates only `.jig/` in your project: `config.jsonc` goes to git, `config.local.jsonc`, `journal/`, `runs/` and `cache/` are ignored by `.jig/.gitignore`.

## Slots and worktrees

Slots need a `slots` section; `worktreesDir` is required. The `worktree` section tunes seeding: `seedExclude` skips ignored paths, `copyFiles` adds files inside ignored folders:

```jsonc
{
  "slots": {
    "worktreesDir": "..",
    "install": "npm ci",
    "ports": { "VITE_PORT": { "base": 5173, "step": 10 } },
    "cdp": { "base": 9222, "step": 1 }
  },
  "worktree": { "seedExclude": ["coverage"] }
}
```

## Guard the config files

jig does not guard config files itself. A plugin cannot write permission rules into your project, so add this deny block to `.claude/settings.json`; `jig doctor` warns when it is incomplete:

```json
{
  "permissions": {
    "deny": [
      "Edit(.jig/config.jsonc)", "Write(.jig/config.jsonc)",
      "Edit(eslint.config.*)", "Write(eslint.config.*)",
      "Edit(tsconfig*.json)", "Write(tsconfig*.json)",
      "Edit(.oxlintrc.json)", "Write(.oxlintrc.json)",
      "Edit(stratum.config.jsonc)", "Write(stratum.config.jsonc)",
      "Edit(.github/workflows/**)", "Write(.github/workflows/**)",
      "Edit(.gitlab-ci.yml)", "Write(.gitlab-ci.yml)",
      "Edit(.husky/**)", "Write(.husky/**)"
    ]
  }
}
```
