# Process adapter

A team's review process differs per project: what signals "review me" (a label, a tracker status, a reviewer assignment), where a verdict is recorded, where the task text lives. `jig review-cycle` owns the mechanics and asks the **adapter** for everything process-specific. jig never names a label or a tracker status itself.

## Where it is configured

`.jig/config.jsonc` or, per reviewer, `.jig/config.local.jsonc`:

```jsonc
{ "reviewCycle": { "processAdapter": "tools/review-process.mjs" } }
```

A path relative to the project root (the main checkout), absolute, or `~/…`. `jig review-cycle <sub> --adapter <path>` overrides it for one call. How jig starts it, by extension:

| Extension | Started as | Note |
| --- | --- | --- |
| `.mjs`, `.js`, `.cjs` | `node <path> <op> …` | Preferred: runs the same on every OS. |
| `.sh` | `bash <path> <op> …` | On Windows: Git for Windows' `bash.exe` (found next to `git`), never WSL's `System32\bash.exe`, which cannot see Windows paths. `JIG_BASH` overrides. Print `repo_dir` with `git rev-parse --show-toplevel` (`C:/…`); a Git Bash path (`/c/…`) is converted. |
| `.ps1` | `powershell -NoProfile -ExecutionPolicy Bypass -File <path>` (`pwsh` elsewhere) | |
| anything else | the file itself | An executable with a shebang on Unix, an `.exe` on Windows. |

The adapter runs with the main checkout as its working directory.

**No adapter configured: the built-in default.** The queue is the forge's open merge requests where you are a reviewer (GitLab: `reviewer_id`; GitHub: review requested from you or reviewed by you), refs are `!<number>`, `rules` is `stale=on`, no spec, no base-check bullets, and `transition` records nothing. `jig review-cycle queue` says so on its first line, `WARNING built-in adapter: …`, and the cycle's summary repeats it: a pass on the wrong queue is caught before anything is posted, not at the verdict.

## Terms

- **ref**: the tracker's handle for one unit of work: `!<iid>` for a label-driven forge, a key such as `PROJ-37` for a tracker. A verdict is applied per ref.
- **refs**: a comma list. One merge request can serve several refs (`PROJ-37,PROJ-38`), and one ref can own merge requests in several repositories.

## Exit codes

`0` done · `2` usage error · `3` the environment could not answer (an API call failed): never a verdict, jig aborts the queue or blocks the merge request · `4` this ref is blocked, reason on stderr: the summary carries it, the cycle goes on.

**Fail, never answer empty.** An unreachable API reads exactly like an empty project; an adapter that prints nothing on a failed call turns "could not look" into "nothing to review". Exit 3 with `ERROR <reason>` on stderr instead.

## Ops

| Op | Output | Used by |
| --- | --- | --- |
| `queue` | `ROW` and `NOTE` lines | `jig review-cycle queue` |
| `rules <refs>` | `key=value` lines | `jig review-cycle queue` |
| `base-check` | `- ` bullet lines, maybe none | `jig review-cycle base-check` |
| `spec <refs>` | one path, or nothing | `jig review-cycle spec` |
| `transition <ref> returned\|ready\|none` | lines for the summary | `jig review-cycle verdict` |

Rows are tab-separated:

```
ROW   <refs>  <repo_dir>  <iid>  <source_branch>  <draft>  <APPROVED|pending>  <web_url>
NOTE  <refs>  <text>
```

- `queue` lists only **triggered** work: the adapter applies its trigger itself. `draft` is `true` or `false`. `APPROVED` means **anyone** approved, not only you: an approved merge request is skipped and its marker cleared. `repo_dir` is the absolute path of a local clone; every per-merge-request call runs there, so one adapter can serve several repositories.
- A `NOTE` is a fact the cycle cannot act on (a ref with no merge request, a ref parked on a human, a merge request with no local clone). The summary prints it verbatim: nothing in the queue disappears silently.
- `rules` keys: `stale=on|off`: whether the stale re-review rule applies to these refs. `off` when the trigger itself means "the developer answered" (a status the developer sets after fixing), so a triggered merge request is never stale. Absent means `off`.
- `spec` prints the path of a file with the task's spec, by the one definition in `skills/jig-review/steps/01-prepare.md` ("Spec"): the task's tracker text with its subtasks and comments, or a spec or PRD document the task links; never a document that only describes the code the task touches. Nothing: the review reads the tasks the merge request names itself, by the same definition.
- `transition` targets: `returned` (the ref goes back to its developer), `ready` (nothing left to fix; the ref waits on a human's approval: approval itself is never an adapter op), `none` (the cycle saw an approval and clears its own marker). jig calls it once per ref, as the last step of a cycle.

## Example

```js
#!/usr/bin/env node
// review-process.mjs: label-driven GitLab. A ref is !<iid>.
import { execFileSync } from 'node:child_process'
const [op, refs, target] = process.argv.slice(2)
const api = (path) => {
  try { return JSON.parse(execFileSync('glab', ['api', path], { encoding: 'utf8' })) }
  catch { process.stderr.write(`ERROR ${path}\n`); process.exit(3) }
}
const repoDir = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim()
if (op === 'queue') {
  for (const mr of api('projects/:fullpath/merge_requests?state=opened&labels=Waiting%20for%20review&per_page=100')) {
    const approved = api(`projects/:fullpath/merge_requests/${mr.iid}/approvals`).approved_by.length > 0
    console.log(['ROW', `!${mr.iid}`, repoDir, mr.iid, mr.source_branch, mr.draft, approved ? 'APPROVED' : 'pending', mr.web_url].join('\t'))
  }
} else if (op === 'rules') console.log('stale=on')
else if (op === 'transition') { /* swap the status label of each ref in `refs` to `target` */ }
else if (op !== 'spec' && op !== 'base-check') process.exit(2)
```
