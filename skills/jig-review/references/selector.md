# Selector

An optional argument: comma-separated tokens without spaces, `important,architecture,tests`. It decides two things: which angles run and which findings are printed. Pass it to `jig review-plan --selector`; the command expands it, `auto` included, and prints the output filter.

## Parsing

The first word after the mode, target and flags is the selector only when it is a preset or **every** token is in the table below. Otherwise it is the start of the focus note ([step 01](../steps/01-prepare.md#focus-note)). An unknown token in a selector whose other tokens are known is an error: name it and stop, do not guess.

No selector: `quick` on the [inline path](../steps/04-inline.md) (`N = 1`, or `N ≤ 2` under the default layout `auto`), otherwise everything runs (`full`), plus `deepening` when the diff adds source files. An explicit `full` on a small diff runs every angle inline.

## Presets

- `full` (default when finders run): every angle, plus `deepening` when the diff adds source files. Cost: on the inline path it adds the cleanup and rules angles to your own reading; with finders it adds the cleanup, rules and tests-and-comments finders (on the 784-line reference merge request the lean layout ran 7 finders on `full` for $10.7, inline on `quick` cost $2.4-2.6);
- `quick` → `important` (default on the inline path): only what a merge waits for (bugs, security, layers and placement, spread across modules, structural smells), without cleanup and `deepening`.

## Tokens

Each token is a predicate over a finding. **A finding is printed when it matches at least one token.** The angles at least one token needs run; the others do not spawn, and their documents and the spec are not searched.

| Token | Angles | Findings it prints |
|---|---|---|
| `important` | angles with ceiling `Important` (below) | only `Important` |
| `bugs` | 1, 2, 3, 4, 5, 12 | all |
| `security` | 14 | all |
| `reuse` | 6 | all |
| `simplification` | 7 | all |
| `efficiency` | 8 | all |
| `altitude` | 9 | all |
| `conventions`, `smells` | 10 | all |
| `docs` | 11 | all |
| `adr` | 13, section C; 11, the ADR part of question 2 | all |
| `glossary` | 13, section D; 11, the glossary part of question 2 | all |
| `architecture` | 13 | all |
| `spec` | 15 | all |
| `tests` | 16 | all |
| `comments` | 17 | all |
| `deepening` | the [deepening](#deepening) proposal, not an angle | outside threads |
| `auto` | chosen by the diff shape (below) | by the chosen tokens |

Example: `important,architecture,adr,tests,comments` runs the angles with ceiling `Important` plus 16 and 17; it prints every `Important`, plus any finding of angles 13, 11 (the ADR part), 16 and 17.

## Angle ceilings

The ceiling is the highest severity an angle gives at [verify](../gates/severity.md). `important` runs only the angles with ceiling `Important`.

- `Important`: 1, 2, 3, 4, 5, 12, 13, 14, 15; 8 (a leak only); 10 (a structural smell only).
- `Nit`: 6, 7, 9, 11, 16, 17.

`angles.<n>.severityCeiling` in the [config](project-config.md) moves an angle between the lists.

## `auto`

Tokens chosen by the diff shape; the summary prints the expansion first: `selector: auto → important,tests`.

- always `important`;
- the diff has tests → `tests`;
- comment lines were added → `comments`;
- the diff has `*.md` → `docs`;
- the diff adds source files → `architecture,deepening`;
- `N = 1` ([layout](../steps/01-prepare.md#layout)) → plus `reuse,simplification,altitude,conventions`: the session reads the diff inline anyway, and the cleanup angles are almost free on it.

## Tiers

Each token runs on a tier and an effort; a finder whose angles differ splits by them ([finders](../steps/04-finders.md#layout-of-angles-over-finders)). Defaults, overridable per token or role in the project config (`tiers`):

| Token or role | Tier / effort |
|---|---|
| `bugs`, `architecture`, `spec`, `altitude` | deep / high |
| `efficiency`, `security`, `reuse`, `conventions`, `docs`, `simplification` | standard / high |
| `tests`, `comments` | standard / medium |
| `verify` (role `verifier`) | deep / medium |
| `outcome` (role `outcome-checker`) | deep / medium |
| `composer` (role `composer`) | standard / medium |
| `deepening` (role `deepener`) | deep / high |

Angle 13 sections C and D (`adr`, `glossary`) run with `architecture`. The verify judge takes another model of its tier than the finder whose candidates it judges ([verify](../steps/05-verify.md#judges)).

## Deepening

Not an angle and not a thread: a proposal, not a defect; verify does not judge it ([angle 13](../angles/13.architecture.md), "not a finding"). One agent, role `deepener`, gets the diff and atom `module-depth`, looks at new and heavily changed modules and returns one deepening, the one with the largest effect: the most leverage for callers and locality for maintainers (how many callers stop knowing what the interface would hide). Format: module, what to deepen, effect, blast radius (how many callers change, with paths). The blast radius is reported but does not decide. Printed as its own section after the findings ([output](../steps/08-output.md#output)); in mode `pre-mr` it goes to Consider. It goes into neither state nor posting.

## Re-review

The selector applies to new findings. The outcome check of earlier findings ([step 09](../steps/09-rereview.md)) runs always: a thread an earlier run opened closes by the fact of the fix, not by the selector.
