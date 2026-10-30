# Flow model

Every review starts with it, before any finder hunts: every layout, a first run and a re-review. One subagent builds it from the flow index `jig review-plan` wrote and writes what each finder would otherwise rediscover from the diff: the features, their states and transitions, and every link across modules. On a 10,263-line merge request seven finders each read all 14 diff parts and traced the same flow again; that was most of a $90 run.

## Spawn

`jig review-plan` printed `flow model:` with the grade, the file it `writes`, the flow index under its `index:` and the atoms. The index is built by code from the changed files and their direct importers: imports, exports and the flow sites by `file:line`, found by patterns per file extension (TypeScript, JavaScript and Vue first; other extensions get their imports only). On !1935 the modeler that read every diff part held 410k tokens and cost $16.9. Spawn **one** subagent, role `flow-modeler` (`<root>/skills/jig/references/roles/flow-modeler.md`), described `Flow model !<iid>` (`Flow model` without a merge request), on that grade, fresh, in the foreground. You do not build the model yourself.

Brief, in this order: the flow index path under `flow model:` `index:` and the diff index; the partitions (the `finder` lines); the project root; the focus note; facts and decisions ([prepare](01-prepare.md#facts-and-decisions)); the spec file when one was found ([prepare](01-prepare.md#spec)); on a re-review, the files of `re-review scope`; the output path; the `run:` id; the atom paths; the role template path.

The output path: the `writes` path, or with state on `<state file without .json>.model.md`, next to the state file.

**Only a retry of the same run reuses it.** `jig review-plan` prints `run: <id>`, new on every plan, and names the model file by it without state (`model-<run>.md`). The file's first line is `run: <id> · head: <reviewed HEAD sha>`. It exists with this run's id: a retry of this run, no spawn. Any other id, or no file: spawn the modeler, which overwrites it. A model from an earlier run is never reused, even on the same diff: two runs compared blind must each build their own.

## Check

Before the finders, read the file once and check: every section of the role's format is present, every transition and link carries a `file:line`, and `Cross-partition links` names each pair of partitions that a link in `Links` connects. A gap: send it back once with the gap named. It stays: name it in the summary (`flow model: <gap>`) and go on.

## Who gets it

- Every finder and every judge: the path, in the shared prefix of the brief ([finders](04-finders.md#spawn), [verify](05-verify.md#second-model-only-for-important)); each reads it itself.
- The deepener: the path.
- The output: the `model:` line ([output](08-output.md#output)), so a caller can hand the model to a UI verification or a bug bash.

The model is a map, not evidence: a verdict quotes code, never the model.

## Re-review

The model is rebuilt on the re-review's range: the files under `re-review scope`, plus their links to unchanged code, which the subagent reads only to name the other side. It overwrites the model of the earlier run.
