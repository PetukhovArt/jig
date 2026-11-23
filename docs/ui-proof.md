# UI proof before the merge request

The [`mr`](../skills/jig/flows/mr.md) step runs `jig pre-mr [<base>] [-- <pathspec>...]`, which diffs the branch against its base; paths after `--` (relative to the current directory, as in git) leave uncommitted work that is not the task's out, and a scope with no changes is an error.

UI proof is asked for only when `.jig/config.jsonc` names a proof tool (`"agent-view": {}`); without one, `jig pre-mr` exits 0 with `Verification level: no UI proof tool configured`. With one, the agent asks the user whether to run the proof (afk: runs it).

A UI file needs proof kinds: `behavior` (the use case still works) and `look` (what the user sees). For agent-view, components and markup (`.vue`, `.tsx`, `.jsx`, `.svelte`, `.html`, not tests) need both, styles (`.css`, `.scss`, `.less`) need `look`.

`jig pre-mr proof "<command>"` runs the command and records the proof when it exits 0: only `agent-view act replay` proves `behavior`, only `agent-view screenshot` or `snap` proves `look`; other commands are refused. A proof counts when no UI file it covers changed after it. A branch that touches UI also needs a break-it record: `jig pre-mr break-it "<bugs found and fixed, what could not be tested>"`. Without them `jig pre-mr` lists what is missing and exits 1.

When the proof cannot run, `jig skip-verify --level unit-test|type-check|none --why "<reason>"` lets `jig pre-mr` pass until the next edit; the level goes to the journal and into the merge request description.

## With a `ui` profile

When `.jig/config.jsonc` has a [`ui`](configuration.md#ui-profile) section and the branch changes UI files (markup, styles or files matching `ui.components.files`, tests excluded), `jig pre-mr` also asks for these proofs. Each is a journal record bound to the working tree, so it counts until one of the UI files it covers is edited afterwards:

| proof | recorded by | asked when |
| --- | --- | --- |
| `ui-reuse` | `jig ui reuse`, when it finds no raw element on changed lines | `ui.components.map` names at least one element |
| `ui-matrix` | `jig ui prove`, when every matrix combination was driven and no audit error stands | an agent-view proof is configured and the matrix has an `auto` combination |
| `ui-mockup` | `jig ui mockup`, when it reports no blocking finding | the branch declared a Figma reference: `.jig/ui/<branch>/reference` holds `figma:<url>`, written by `jig ui mockup --figma <url>` or `jig ui prove --reference figma:<url>` |

A gap prints the command to run. `jig pre-mr proof` takes none of them: the `jig ui` commands record their own proof, and only when they pass. A branch whose only gaps are the static ones (no agent-view proof configured) is not asked for a break-it record. `jig skip-verify` stays the way out when a proof cannot run.
