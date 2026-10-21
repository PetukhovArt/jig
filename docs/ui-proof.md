# UI proof before the merge request

The [`mr`](../skills/jig/flows/mr.md) step runs `jig pre-mr [<base>] [-- <pathspec>...]`, which diffs the branch against its base; paths after `--` (from the repository root) leave uncommitted work that is not the task's out.

UI proof is asked for only when `.jig/config.jsonc` names a proof tool (`"agent-view": {}`); without one, `jig pre-mr` exits 0 with `Verification level: no UI proof tool configured`. With one, the agent asks the user whether to run the proof (afk: runs it).

A UI file needs proof kinds: `behavior` (the use case still works) and `look` (what the user sees). For agent-view, components and markup (`.vue`, `.tsx`, `.jsx`, `.svelte`, `.html`, not tests) need both, styles (`.css`, `.scss`, `.less`) need `look`.

`jig pre-mr proof "<command>"` runs the command and records the proof when it exits 0: only `agent-view act replay` proves `behavior`, only `agent-view screenshot` or `snap` proves `look`; other commands are refused. A proof counts when no UI file it covers changed after it. A branch that touches UI also needs a bug-bash record: `jig pre-mr bug-bash "<bugs found and fixed, what could not be tested>"`. Without them `jig pre-mr` lists what is missing and exits 1.

When the proof cannot run, `jig skip-verify --level unit-test|type-check|none --why "<reason>"` lets `jig pre-mr` pass until the next edit; the level goes to the journal and into the merge request description.
