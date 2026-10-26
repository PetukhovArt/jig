# Two or three slots with running app instances

A **slot** is a git worktree with packages installed and the dev server always running, bound to a number N that offsets every port (dev server, CDP/verify). Slot 0 = the main checkout, left untouched. Slots 1 to 3 run concurrently and **show** branches: features are written in their own worktrees, where no dev server runs, and a slot checks a finished branch out (Show a branch, below). Everything (ports, CDP) derives from N by a fixed formula (`parallel-no-app.md`, Slot math), so two slots never overlap.

## Config: the `slots` section of `.jig/config.jsonc`

All project-specific knobs live there; a human edits it. Missing section: `jig slot new` refuses with a hint. Then detect the values below, propose the section to the user and wait for them to write it. Never hardcode ports or commands.

```jsonc
"slots": {
  "worktreesDir": "..",            // where worktree dirs go (sibling dirs, or ".claude/worktrees")
  "install": "npm ci --prefer-offline --no-audit --no-fund",
  "dev": "npm run dev",
  "runtime": "electron",            // electron | tauri | browser | none: the APP runtime, drives instance identity and launch
  "verifyRuntime": "browser",       // optional: the adapter agent-view attaches with. Defaults to `runtime`
  "linkedPackages": ["@scope/pkg"], // local npm-link deps to re-link after install ([] if none)
  "ports": {                        // env keys the dev server reads; written into the slot's target file
    "VITE_SERVER_PORT": { "base": 3000, "step": 10, "target": ".env" }
  },
  "cdp": { "base": 9876, "step": 1 }, // remote-debugging port for agent-view/verify
  "slotEnv": { "key": "SLOT", "target": ".env" }, // optional: the slot number itself, for a dev script that derives its ports from it
  "instance": { },                  // per-runtime identity so N app instances coexist, see Instance isolation
  "clearCache": []                  // build-cache dirs to wipe per slot when env is baked at build time
},
"worktree": {                      // read by `jig worktree seed`, so by every slot and feature worktree
  "seedExclude": [],                // globs of ignored paths not to seed (forward slashes, from the repo root)
  "copyFiles": []                   // files inside a folder ignored in full that seed must copy too
}
```

What to detect:

| Field | How to detect |
|---|---|
| `install` | lockfile → `package-lock.json` ⇒ `npm ci`; `pnpm-lock.yaml` ⇒ `pnpm i --frozen-lockfile`; `yarn.lock` ⇒ `yarn --immutable`. Non-JS: ask. |
| `dev` | `package.json` scripts: pick the one that starts the local dev server (`dev`, `start`, `dev:web`…). Ask if ambiguous. |
| `runtime` | The **app** runtime. `electron` in deps ⇒ `electron`; `@tauri-apps/*` or a `tauri.conf.json` (glob: `src-tauri/`, `tauri/`, …) ⇒ `tauri`; a Vite/webpack web app ⇒ `browser`. A bare node server has no app runtime (`none`): it still takes slot ports, but `agent-view` can't drive it. |
| `verifyRuntime` | The **adapter** `agent-view` attaches with: only `electron`/`tauri`/`browser`, and it is what goes into `agent-view.config.json` `runtime`. Omit when it equals `runtime`. Set it when the app ships as a native shell but you verify against the dev server in Chrome (`runtime: "tauri"` + `verifyRuntime: "browser"`): a real and supported split, not a misconfiguration. |
| `ports` | Where the dev server reads its port. Often an **env key** in vite/webpack/server config (`process.env.*PORT*`, `server.port`). Each entry: `base` (current value) + `step` (default 10) + `target` (default `.env`). For **tauri** the frontend port is usually a literal in `build.beforeDevCommand` plus `build.devUrl`: override both through a generated config file (Instance isolation → tauri). |
| `linkedPackages` | Local deps resolved via `npm link` / `file:` / `workspace:`, or symlinks under `node_modules/<scope>` pointing **outside** the repo. `[]` if none. |
| `worktree.copyFiles` | Seed already copies every ignored file outside a folder ignored in full, nested env files included. List only a file the build needs **inside** such a folder (`git ls-files --others --ignored --exclude-standard --directory` prints the folder as one `dir/` line). Paths relative to repo root. `[]` if none. |
| `worktree.seedExclude` | Ignored files that must not reach another checkout: large local dumps, per-machine state. `[]` if none. |
| `clearCache` | Build-cache dirs to wipe per slot **when env is baked at build time** (webpack `DefinePlugin`, Vite `define`). Usually `["node_modules/.cache"]`. `[]` when env is read at runtime, **or** when the project derives its cache key from the baked env (Install and build cache). |
| `cdp` | Default `{ "base": 9876, "step": 1 }`. Avoid 9222 (Chrome's own default). |
| `slotEnv` | Only when the dev script already derives its ports from a slot number in the env (`SLOT`, `INSTANCE`): `{ "key": "<that variable>", "target": "<the env file the script loads>" }` (`target` defaults to `.env`). The slot's file then carries `<key>=N`, so the base `dev` and `launch` start slot N's instance unchanged. Omit otherwise. |
| `instance` | **electron:** `{ "userDataFlag": "--user-data-dir", "userDataDir": "<scratch>/userdata" }`. **tauri:** `{ "identifierBase": "<identifier from tauri.conf.json>", "configPatch": true, "cdpEnv": "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS" (Win) / "WEBKIT_INSPECTOR_SERVER" (Linux) }`. **browser:** `{ "userDataFlag": "--user-data-dir", "userDataDir": "<scratch>/chrome-profile" }`. |

Rules for the proposal:
- Read port **base** values from the main checkout's actual config/`.env`; do not guess. If `.env` is unreadable (secrets policy), ask the user for the current port values by name only: never echo other `.env` contents.
- `step` must exceed the count of ports a single instance opens, so adjacent slots can't overlap (10 is safe).
- Restate the slot math with the real numbers so the user can sanity-check (e.g. "slot 1 → VITE_SERVER_PORT=3010, CDP=9877").
- **A `dev:cdp` (or similar CDP-enabled) script is a hint, not a launch.** It usually hardcodes the CDP port and frontend port, and a `cross-env` inside it overrides outer env, so you can't shift the port from outside. Read it for the mechanism (which env var carries the debug port), then build a parametrized per-slot launch (Instance isolation → tauri).

### Cross-project port bands

Slot math is per-repo, so two projects with the same bases collide the moment their slots run at the same time, and the collision surfaces as `EADDRINUSE` or, worse, as `agent-view` attaching to *the other project's* app on a shared CDP port. Which projects exist and which bands they hold is a property of this machine. Derive it before proposing a new project's section:

1. **Find the sibling configs.** Glob for `.jig/config.jsonc` across the checkout root(s) the user works in and read each `slots.cdp` and `slots.ports.*` base and step.
2. **Compute each occupied band**: `cdp.base` to `cdp.base + step*(highest plausible slot)`; treat a band as reserved well past the slots currently provisioned.
3. **Claim a free one**, and propose a comment next to `cdp` naming the bands it was made disjoint from. The comment is what the next detection reads.

Leave a gap of at least `10 × step` between CDP bands. Avoid `9222` and anything a local service already listens on (`netstat` before claiming).

## Provision

`jig slot new [--slug <s>] [--branch <b>]` does, in order: `git worktree prune`; the lowest free N; `git worktree add`; `jig worktree seed` (every gitignored file and symlink of the main checkout, see Seed); writes each port key `base + N*step` into its `target`, and `slotEnv.key=N` into its `target`; writes the slot's `agent-view.config.json` with `cdp.base + N*cdp.step` and the main checkout's `url` moved to the slot (a local port that a `ports` entry starts at becomes that entry's slot port; another local port is left out with a warning, since it would reach slot 0; a remote URL stays); wipes `clearCache`; runs `install` in the slot. It prints `slot <N> <path> ports <k=v ...> cdp <port>`.

Then, inside the printed path:
1. **Relink**: re-link every `linkedPackages` entry: a plain `npm ci`/`install` reverts local `npm link` deps to the registry copy.
2. **Env files**: check the dotenv path in the bundler config. An env file inside a folder ignored in full is not seeded, and the miss is silent: the build falls back to the tracked defaults and the app points at the wrong backend with no error. Tell the user which `worktree.copyFiles` entry to add.
3. **Instance identity and launch** (hard requirement): every slot runs its **own app process** alongside the others. `launch` is copied from the main checkout (or `dev`) as is: it reaches slot N's ports only when the command reads them from the env files jig wrote (`ports`, `slotEnv`). Otherwise apply the per-slot app identity and bake the CDP port and identity into the `launch` string of the slot's `agent-view.config.json` (Instance isolation, below). Provisioning is **not complete** until the multi-instance sanity check passes.
4. Print a summary: dir, branch, slot N, each dev port and URL, CDP port, and the dev/verify commands to run **from the slot dir**.

## Seed

`jig worktree seed <dir>` fills a worktree from the main checkout with what `git worktree add` leaves behind. It copies every gitignored file and recreates every gitignored symlink: a link into the main checkout is re-pointed at the same path in the worktree, any other link keeps its target. It looks one level into each folder ignored in full for symlinks (a linked skill under `.claude/skills/`). It copies no folder (`node_modules`, `dist`: each checkout builds its own), skips `worktree.seedExclude`, and never overwrites a file already there, so a file the branch tracks wins. It prints one line per copied or linked file and a count. Run it again at any time: it only adds what is missing. On Windows a directory link needs Developer Mode; without it seed makes a junction.

## Show a branch

`jig slot show <N> <branch|commit>` runs `git checkout --detach <branch>` in slot N: the running dev server reloads once. When a lock file differs between the old and the new commit, jig installs: the `install` command of the `slots` section if set, otherwise the package manager named by the lock file (`package-lock.json` → `npm ci`, `pnpm-lock.yaml` → `pnpm install --frozen-lockfile`, and so on), run in the lock file's folder. It prints `slot <N> <path> at <sha> <branch>`. It refuses while the slot has tracked changes: a slot shows branches, edits belong in a feature worktree. Only commits travel: commit in the feature worktree, then `show` again. A dependency change can need a dev server restart that the hot reload does not do.

## Install and build cache

**Own `node_modules` per slot, shared global package cache.** A fresh slot needn't re-download anything; only unpacking costs time. Prefer `npm ci --prefer-offline --no-audit --no-fund` as `install`: `--prefer-offline` pulls tarballs from the warm global cache (`~/.npm`, `%LocalAppData%\npm-cache` on Windows), `--no-audit --no-fund` cut the slowest non-essential round-trips. Each slot's tree stays independent, so different branches can pin different deps.

If the lockfile pins stale integrity for republished internal/private packages (`npm ci` → `EINTEGRITY` / `EUSAGE`), install **without** the lockfile (`npm install --no-package-lock`) so it resolves current registry integrity.

**Build cache must live inside the worktree.** Bundler caches default into the dependency tree (`node_modules/.cache/webpack`, `node_modules/.vite`), which makes them collateral damage of any reinstall. Point them at a worktree-root dir (webpack `cache.cacheDirectory`, vite `cacheDir` → `<worktree>/.webpack-cache`, resolved from the config's own `__dirname`) so a reinstall keeps them.

**Baked env vs a stale cache.** When env is inlined at build time (webpack `DefinePlugin`, Vite `define`), a reused cache serves the **stale baked values** even after you fix the env file: webpack's filesystem cache keys on config and lockfile, *not* on env files. Symptom: the env file is correct on disk, but the running app still hits the old backend until the cache is cleared and the dev server restarted.
- **Stopgap:** `clearCache`.
- **Durable fix (project-side):** put the baked values into the cache **key** (`cache.name`/`cache.version` derived from the env vars the build inlines). `buildDependencies` does **not** cover this: it tracks *files*, not `process.env`. Then `clearCache` can be `[]`.

Installs that fail intermittently on a dependency whose **postinstall downloads a binary** (`ECONNRESET` from the download host: infra, not code): when the bundler doesn't need that package at build time, install with `--ignore-scripts`, then copy its `node_modules/<pkg>` dir from the main checkout.

## Instance isolation

Two hard guarantees per slot N: its own app process runs in parallel with every other slot, and a CDP/agent-view client run from slot N attaches **only** to that slot's app. Both reduce to a distinct **identity** (so the OS single-instance lock and the app's data dirs differ) and a distinct **CDP port**.

`agent-view.config.json` of a slot:

```jsonc
{
  "runtime": "browser",           // "electron" | "tauri" | "browser": the ADAPTER, i.e. verifyRuntime
  "port": 9877,                   // cdp.base + N*step
  "launch": "npm run dev",        // the slot's launch line
  "allowEval": true
}
```

`runtime` is validated against a closed set: anything else makes the config **fail to load**. `launch` is spawned **verbatim**: `agent-view` injects no flags of any kind. Debug port, user-data dir, identifier, frontend port: all must already be in that string. `agent-view launch` also runs it in the **shell's** cwd, not the dir the config resolved from.

Why a second instance is normally blocked:
- **Electron**: apps that call `app.requestSingleInstanceLock()` hand off to the first instance and quit the second. Even without the lock, two instances sharing one `userData` dir corrupt each other. **Always isolate `userData` per slot.**
- **Tauri**: `tauri-plugin-single-instance` enforces one process keyed on the app **identifier**. App data lives under that identifier too. **Give each slot a distinct identifier.**

### electron
- **Identity:** `--user-data-dir=<scratch>/userdata` on launch, or the project's user-data env var per slot. This dodges the single-instance lock (keyed on the userData path) and prevents shared-state corruption.
- **CDP:** `--remote-debugging-port=<cdp>` in the launch command. Electron only reads the switch if the main process forwards it (`app.commandLine.appendSwitch`); bundlers like `electron-vite` swallow CLI args passed through `npm run dev`, so the usual carrier is an env var the main process reads.

**Hardcoded port / shared userData in tracked source (common).** Make the source read env, current value as fallback (behavior unchanged when env unset):
```js
app.commandLine.appendSwitch("remote-debugging-port", process.env.WC_REMOTE_DEBUG_PORT || "9889");
// before requestSingleInstanceLock():
if (process.env.WC_USER_DATA_DIR) app.setPath("userData", path.resolve(process.env.WC_USER_DATA_DIR));
```
You don't want this diff on every task branch. Either commit the env-gated change once to the base branch (preferred), or apply it in the slot and `git update-index --skip-worktree <file>` so git never reports it (each worktree has its own index). Re-apply if that file changes upstream.

### tauri
`tauri.conf.json` lives in a dir that varies (`src-tauri/`, `tauri/`, …): glob for it. Identity, frontend port and CDP all override without touching tracked files, **via a generated config file, not the `TAURI_CONFIG` env var**.

> **`TAURI_CONFIG` env does not work on the Tauri v2 CLI (verified on 2.10): the patch is silently ignored.** The slot then inherits slot 0's `devUrl` and `beforeDevCommand` and dies on `EADDRINUSE` for the main checkout's frontend port. Write the patch to `<scratch>/tauri-slot-<N>.conf.json` and pass `tauri dev --config <abs path>`. If a project dev script already writes this file into the worktree, leave it there and make sure it is gitignored.

- **Identity:** `com.acme.app` → `com.acme.app.s<N>` in the patch file. Check the Rust side for `tauri-plugin-single-instance`: if absent (common), multiple instances already run natively.
- **Frontend dev port:** patch **both** `build.devUrl` and `build.beforeDevCommand` so they agree: `{"build":{"devUrl":"http://localhost:<port>","beforeDevCommand":"<serve cmd with --port=<port>>"}}`. Patching only one is the common miss.
- **CDP (webview):** env on launch (devtools enabled in the build): Windows `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=<cdp>`, Linux `WEBKIT_INSPECTOR_SERVER=127.0.0.1:<cdp>`.

Don't reuse an existing `dev:cdp` script as-is. Either make the script slot-aware once on the base branch (it reads `SLOT`/`CDP_PORT`/`WEBPACK_PORT`, writes the patch file when `SLOT > 0` and execs `tauri dev --config`), or build the launch per slot:
```
npx cross-env APP_ENV=dev \
  WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=<cdp> \
  npx tauri dev --config <scratch>/tauri-slot-<N>.conf.json
```
A script that spawns `tauri dev` **once** is the safer shape: an auto-restarting supervisor that kills whatever holds "its" ports will, from a slot with default ports, kill the main checkout's dev server.

### browser
- **Identity:** per-slot `--user-data-dir=<scratch>/chrome-profile`: without it Chrome's profile lock hands the URL to the already-running instance, on *its* debug port.
- **CDP:** `--remote-debugging-port=<cdp>` in the same launch string.
- **Target:** the slot's own dev URL (`http://localhost:<port base + N*step>/`). The three must agree; nothing validates that they do.

This is the runtime when the app ships as Electron/Tauri but verification drives **Chrome against the dev server** (`verifyRuntime: "browser"`). The dev server then starts separately on the slot's frontend port; the native-shell launch is a different path and must not run at the same time on the same ports.

A bare node server (`runtime: "none"`) is not an `agent-view` runtime: it can carry `--inspect=<cdp>`, driven with a CDP client directly.

### Multi-instance sanity check (provisioning is not done until this passes)

1. Start the **main** checkout (slot 0) app, leave it running.
2. From the slot dir, start the slot-N app. **Both windows must be open at once**: the second must not quit, hand off, or hijack the first.
3. From the slot dir: `agent-view discover` → exactly one target on the slot's CDP port.
4. From the main checkout: `agent-view discover` → a **different** target.

If the second instance dies on launch: identity isn't isolated, fix it before continuing. If `discover` finds nothing: `agent-view launch`; on `PORT_CONFLICT` surface the owning PID and ask the user: don't kill foreign processes.

## Run: which app instance does verify target?

From the slot dir: `dev` starts that slot's server on its own ports; `agent-view` commands resolve the local `agent-view.config.json` and touch only this slot's CDP. Identity carrier = the **CDP port**:

> session cwd = slot dir `<repo>-s<N>-<slug>` → its `agent-view.config.json` → `port = cdp.base + N` → the one app instance bound to that port.

One Electron/Tauri process owns exactly one CDP port, so **port ⇔ instance, 1:1**. (Window/worker selection *within* the instance is then `--window` / `--target`.)

**A missing config does not reliably fail.** agent-view ≥ 0.11.0 walks **up** from cwd to the filesystem root, like git finding `.git`: a missing config silently resolves to an ancestor's. ≤ 0.10.x reads cwd only and fails loudly. Assume walk-up when unsure. A sibling slot (`worktreesDir: ".."`) has no ancestor config and fails loudly by accident; a worktree inside the repo attaches to **slot 0** and reports success (`native-worktrees.md`).

Three invariants:
- **Every slot has its own `agent-view.config.json`.** Never rely on inheritance; the inherited one is slot 0's.
- **Run `agent-view` only from the slot dir.** Config resolution and the launch cwd both depend on it.
- **The dev launch binds the *same* CDP port and identity as the config.** Otherwise a manual `dev` spawns a second, port-less instance and verify attaches to a different one than you're developing in.

**`agent-view logs` under parallel slots needs agent-view ≥ 0.13.1.** One daemon serves every checkout; up to 0.13.0 its console/network/log state was global, so a `logs` call from one slot wrote and truncated another slot's feed file. 0.13.1 buckets that state per CDP port. Keep the default relative `logFile` (one feed per worktree) and run `logs` from the slot dir. On older versions with more than one slot live, read the console through your own CDP hook on the slot's port (`ws://127.0.0.1:<cdp>`, target from `/json/list`, collect `Runtime.consoleAPICalled` and `Log.entryAdded` into the slot scratch dir).

## Windows launch

Applies to **every** detached launch typed into the agent's shell tool on Windows (`dev`, an `agent-view launch`, a bare `webpack serve`), main session included. When that shell is Git Bash (MSYS2; Claude Code's Bash tool), it rewrites arguments **before** `cmd.exe` sees them, and each failure raises a **modal dialog** that blocks the calling shell until a human clicks OK:

| One-liner | What cmd received | Symptom |
|---|---|---|
| `cmd //c start "" /b …` | `/b` → `B:\` (MSYS path conversion) | dialog `B:/ — The system cannot find the drive specified` |
| `cmd /c start "title" cmd /c …` | quotes stripped → `start title …` | dialog `Windows cannot find 'title'` |
| `cmd /c "X:\a\b.cmd"` | `\a\b` → `ab` (bash eats `\` inside double quotes) | `'X:ab.cmd' is not recognized` |

**Do not fix this with escaping.** Write two `.cmd` files with the agent's file-write tool (Claude Code: Write; or a quoted heredoc, `<<'EOF'`; `printf` and `node -e` read `\f`, `\U`, `\u` in Windows paths as escapes) into the scratch dir `%TEMP%\jig-slots\<repo>-s<N>\` (`<scratch>`), outside the worktree:

```cmd
:: <scratch>\slot-dev-run.cmd
@echo off
title slot<N> <worktreeDir> [<branch>] localhost:<devPort>
start "" /b cmd /c "ping -n 16 127.0.0.1 >nul & title slot<N> <worktreeDir> [<branch>] localhost:<devPort>"
cd /d <dir>
<the slot's launch line with its port math substituted> > <scratch>\slot-dev.log 2>&1
```
```cmd
:: <scratch>\slot-dev-detach.cmd
@echo off
start "slot<N> <worktreeDir> [<branch>] localhost:<devPort>" /min cmd /c <scratch>\slot-dev-run.cmd
```

- Title = slot number, the worktree **dir name** (no path), the branch in square brackets, the dev URL. Never use `|`, `&` or `>` in it: `title` is a `cmd` builtin and those are shell operators.
- **The delayed `title` line is required.** `npx`/`cross-env`/the bundler rewrite the console title after start, so every slot window ends up named `webpack`. The 16-ping (~15 s) delay must outlast the dev server's own startup output.
- Invoke with the absolute path in **single** quotes: from Git Bash `MSYS_NO_PATHCONV=1 cmd /c '<scratch>\slot-dev-detach.cmd'`, from PowerShell (no path conversion there) `cmd /c '<scratch>\slot-dev-detach.cmd'` → expect `rc=0`, then prove liveness by port, never by exit code. Relative invocation was observed to fail.
- **A failed launch is a modal dialog, not an error string.** After the *first* timeout, stop retrying the one-liner and switch to the `.cmd` launcher.
- **`cross-env` (and other `node_modules/.bin` tools) won't resolve bare in a `launch` string** run by `agent-view`/`cmd`: npm only adds `.bin` to PATH for `npm run`. Use `npx cross-env …`, the `.bin` path, or `cmd /c set "K=v"&& …`.

## Teardown

**A slot can have more than one launch path alive at once.** When `verifyRuntime` differs from `runtime`, the native-shell path and the browser-verify path are separate process trees on **two different CDP ports**. Killing one leaves the other, which re-serves the dev port. Before declaring a slot stopped, enumerate every port the slot can own (each dev port, the app-runtime CDP, the verify CDP) and confirm all are free after a short delay.

1. Stop the slot's processes **by this slot's ports** (`netstat -ano | findstr :<port>` → `taskkill /PID`; POSIX `lsof -ti :<port>`), never by process name, which would hit the main checkout and every other slot. Never kill a port you did not provision.
2. Delete `<scratch>`.
3. `jig slot rm <N>`: it refuses while the worktree has tracked changes. A tracked change left in the slot: stop and report; `--force` only when the user agrees. The branch stays; delete it only if the user asks.

## Guardrails

- Before starting a dev server, if a configured port is already LISTENing (a stray process, not this slot), report the owning PID and ask: don't kill foreign processes.
- **Changing `cdp.base`/`ports` does not migrate live slots.** Existing slots keep the `agent-view.config.json` generated under the *old* base, so their `port` silently disagrees with the launch built from the new math, and `discover` exits **0** against whatever holds the stale port. After any base change, re-derive every live slot's config or remove the slot. Cross-check `port` against the CDP port inside `launch`: if they differ, the config is stale, not the app.
- The generated per-slot files (`.env`, `agent-view.config.json`) are local: keep them out of task branches (`.git/info/exclude`).
- Old slots no longer needed: `jig worktree sweep` lists every worktree by bucket (`hold-current`, `hold-locked`, `hold-wip`, `hold-open-mr`, `prunable`, `recent`, `safe`) and deletes nothing. After the user agrees to an item: `jig worktree sweep --yes <path|N>`, one `--yes` per item; in a terminal of their own the user can run `--ask`. Stop the slot's processes by port first. The buckets `hold-current`, `hold-locked`, `hold-wip` are never deleted.
