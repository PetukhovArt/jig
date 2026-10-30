# Flow model

Every review starts with it, before any finder hunts: the inline path and every layout, a first run and a re-review. One subagent reads the whole diff once and writes what each finder would otherwise rediscover from it: the features, their states and transitions, and every link across modules. On a 10,263-line merge request seven finders each read all 14 diff parts and traced the same flow again; that was most of a $90 run.

## Spawn

`jig review-plan` printed `flow model:` with the grade, the file it `writes`, the code parts under its `diff:` and the atoms. Spawn **one** subagent, role `flow-modeler` (`<root>/skills/jig/references/roles/flow-modeler.md`), described `Flow model !<iid>` (`Flow model` without a merge request), on that grade, fresh, in the foreground. On the inline path too: you do not build the model yourself.

Brief, in this order: the diff index and the part paths under `flow model:` `diff:`; the partitions (the `finder` lines, or `every file as one partition` on the inline path); the project root; the focus note; facts and decisions ([prepare](01-prepare.md#facts-and-decisions)); the spec file when one was found ([prepare](01-prepare.md#spec)); on a re-review, the files of `re-review scope`; the output path; the atom paths; the role template path.

The output path: the `writes` path, or with state on `<state file without .json>.model.md`, next to the state file.

**A retry reuses it.** The file exists and its first line is `head: <reviewed HEAD sha> · diff: <this run's diff folder name>`: no spawn. Another head or diff: the subagent overwrites it.

## Check

Before the finders, read the file once and check: every section of the role's format is present, every transition and link carries a `file:line`, and `Cross-partition links` names each pair of partitions that a link in `Links` connects. A gap: send it back once with the gap named. It stays: name it in the summary (`flow model: <gap>`) and go on.

## Who gets it

- Every finder and every judge: the path, in the shared prefix of the brief ([finders](04-finders.md#spawn), [verify](05-verify.md#brief), [inline judge](04-inline.md#second-model-only-for-important)). A fork already holds it: you read it in the check above.
- The deepener: the path.
- The output: the `model:` line ([output](08-output.md#output)), so a caller can hand the model to a UI verification or a bug bash.

The model is a map, not evidence: a verdict quotes code, never the model.

## Re-review

The model is rebuilt on the re-review's range: the files under `re-review scope`, plus their links to unchanged code, which the subagent reads only to name the other side. It overwrites the model of the earlier run.
