---
name: jig-task-status
description: "Keep a reviewable decision trail of a long or unattended run: one TSV row per decision, step or question, and an HTML page built from it on demand. Use for /jig-task-status, or when an unattended flow such as afk-mode reads this procedure."
disable-model-invocation: true
---

# jig task status

The trail is one append-only TSV journal per branch: `.jig/runs/<branch>/task-status.tsv` in the project, kept out of git. A reviewer who stepped away reads it, or the page built from it, and follows the evidence.

CLI: `node "<root>/bin/jig.mjs" task-status <log|open|path>`. `<root>` is the plugin root: `${CLAUDE_PLUGIN_ROOT}` when the agent sets it, otherwise the directory two levels above this file.

## Commands

| Command | Does |
| --- | --- |
| `task-status log <phase> <decision> [--why <text>] [--evidence <text>] [--result <text>]` | Appends one row stamped with the current time, writes the header on first use, prints the journal path. Quote each value. |
| `task-status open [--lang en\|ru] [--no-browser]` | Builds `task-status.html` next to the journal from its rows, opens it in the default browser and prints the page path. `--lang` is the language of the page labels, default `en`. `--no-browser` only builds it; with `CI` set the browser stays closed. |
| `task-status path` | Prints the journal path. Exits 1 when the branch has no journal yet. |

Columns: `ts`, `phase`, `decision`, `why`, `evidence`, `result`. Every cell stays on one line: the CLI turns tabs and line breaks into spaces and keeps backslashes, so a Windows path in evidence stays intact.

## Procedure

1. Start. Run `task-status path`. When a journal exists, read its last rows: rows another run wrote since your last turn mean a new run begins. Log the first row of your run as `log start "<task title>" --why "<ts range of earlier rows this run did not write, or: new journal>" --evidence "<your agent or session id>"`. Use phase `start` for nothing else. A pickup, a replacement agent or a new chat is a new run; later turns of the same conversation are not.
2. Steps. When a flow gives you steps, log each change of state: `log step "<step title>" --result active`, then `--result done`, or `--result "blocked: <what it waits for>"`. Keep the title identical across rows: the page shows the latest row per title.
3. Decisions. Log decision points and checkpoints, not every action: a fork chosen, a unit finished with its check result, a pivot or revert with its trigger, a blocker, a gate fixed, one row per iteration of a measuring loop. Phase is the phase or workstream name. `--why` says the reason in plain words. `--evidence` is a pointer, never a paragraph: commit SHA, `file:line`, an artifact or screenshot path, a link, an MR number. `--result` is the outcome: `kept`, `reverted`, `tests green`, `VERIFIED`, `NOT VERIFIED`, `INCONCLUSIVE`, `open`.
4. Questions in an unattended run. Log the question, go on with the default: `log question "<question>" --why "<the option you went with and why>" --result open`. When the user answers, log the same question text with `--result "answered: <answer>"` and follow the answer. On the page a click on an open question opens its answer box, and a `Copy answers` button copies the answers; the pasted text gives each question on its own line followed by `→ <answer>`. In an attended session ask in your reply instead.
5. Corrections. The journal is append-only. A wrong row gets a new row that supersedes it; never edit or delete a row.
6. Audit before handing back. Walk the rows of your run against what happened (`git log`, the diff, your transcript): every row maps to a real decision or action, every evidence pointer resolves and shows what the row claims, and every fork or abandoned approach that shaped the work has a row. Fix gaps with new rows.
7. Report. Run `task-status open` in the session language as the last command of the run, so the page is in the user's browser when the run ends, and give the user the page path and the journal path once.

The page is a snapshot of the journal at build time: run `open` again to see newer rows.

## Where the trail goes

The journal stays local by default. When a reviewer needs the trail to trust the result, copy it into the merge request or commit it under a path the user names.
