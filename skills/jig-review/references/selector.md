# Selector

An optional argument: comma-separated tokens without spaces, `important,spec`. It decides two things: which angles run and which findings are printed. Pass it to `jig review-plan --selector`; the command expands it, `auto` included, and prints the output filter.

## Parsing

The first word after the mode, target and flags is the selector only when it is a preset or **every** token is in the table below. Otherwise it is the start of the focus note ([step 01](../steps/01-prepare.md#focus-note)). An unknown token in a selector whose other tokens are known is an error: name it and stop, do not guess.

No selector: everything runs (`full`), plus `deepening` when the diff adds source files, at every diff size.

## Presets

- `full` (default): every angle, plus `deepening` when the diff adds source files;
- `quick` → `important`: only what a merge waits for, without `deepening`.

## Tokens

Each token is a predicate over a finding. **A finding is printed when it matches at least one token.** The angles at least one token needs run; the others do not spawn, and the spec is not searched.

| Token | Angles | Findings it prints |
|---|---|---|
| `important` | angles with ceiling `Important` (below) | only `Important` |
| `bugs` | 1, 2, 3, 4, 5, 12 | all |
| `security` | 14 | all |
| `efficiency` | 8 | all |
| `spec` | 15 | all |
| `tests` | 16 | all |
| `deepening` | the [deepening](#deepening) proposal, not an angle | outside threads |
| `auto` | chosen by the diff shape (below) | by the chosen tokens |

Example: `important,spec` runs the angles with ceiling `Important` plus 15; it prints every `Important`, plus any finding of angle 15.

## Angle ceilings

The ceiling is the highest severity an angle gives at [verify](../gates/severity.md). `important` runs only the angles with ceiling `Important`. Every angle has the ceiling `Important` by default; `angles.<n>.severityCeiling` in the [config](project-config.md) moves an angle or a project angle to `Nit`, and a project angle without a ceiling counts as `Important`.

## `auto`

Tokens chosen by the diff shape; the summary prints the expansion first: `selector: auto → important,deepening`.

- always `important`;
- the diff adds or changes tests → `tests`;
- the diff adds source files → `deepening`.

## Tiers

A finder's grade comes from its kind, not from its angles ([finders](../steps/04-finders.md#partitions-and-kinds)). Defaults, overridable per kind or role in the project config (`tiers`):

| Kind or role | Tier / effort |
|---|---|
| `behavior` (angles 1–5, 8, 12, 14, 15, and project angles of kind `behavior`) | deep / high |
| `conventions` (project angles of kind `conventions` only) | standard / high |
| `tests` (angle 16, role `test-reviewer`) | standard / medium |
| `verify` (role `verifier`) | deep / medium |
| `outcome` (role `outcome-checker`) | deep / medium |
| `composer` (role `composer`) | standard / medium |
| `deepening` (role `deepener`) | deep / high |

The verify judge takes another model of its tier than the finder whose candidates it judges ([verify](../steps/05-verify.md#judges)).

## Deepening

Not an angle and not a thread: a proposal, not a defect; verify does not judge it. One agent, role `deepener`, gets the diff and atom `module-depth`, looks at new and heavily changed modules and returns one deepening, the one with the largest effect: the most leverage for callers and locality for maintainers (how many callers stop knowing what the interface would hide). The brief names the comment language: the text fields and the diagram labels are written in it. Format, with a budget of about 600 characters for the text ([deepener](../../jig/references/roles/deepener.md)): module, what to deepen in one sentence with its places as paths, effect, blast radius as counts with the paths apart, and `diagram`: a before and an after vertical Mermaid `flowchart TB` of at most 7 nodes (modules as nodes, the leaking ones in red, the deep one dark, edges only from imports the deepener read). The blast radius is reported but does not decide. Printed as its own section after the findings ([output](../steps/08-output.md#output)); in mode `pre-mr` it goes to Consider. With state on it is written to state as `deepening` ([schema](state-schema.md)) and posting puts it in the FYI note as its own section, the paths and the diagram under `<details>` ([posting](posting.md#8-the-fyi-note-one-per-merge-request)): never a thread, never in the tally, never under the outcome check.

## Re-review

The selector applies to new findings. The outcome check of earlier findings ([step 09](../steps/09-rereview.md)) runs always: a thread an earlier run opened closes by the fact of the fix, not by the selector.
