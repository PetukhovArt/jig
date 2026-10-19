# Inline review

The inline path: `jig review-plan` printed `path: inline` (`N = 1`, or layout `inline` at any size). On a small diff a finder subagent and a judge per cluster cost more than they find: you hunt and judge in this session, and a second model judges only what would block the merge. Steps 04-finders and 05-verify do not apply.

## Hunt

1. Read the files under `path: inline` in the layout: `read:` (the angle files) and `atoms:` (the atoms they name). They are absolute paths: read them, do not search for them. No other angle file applies.
2. Read the diff once (`git diff <merge base>`), then every function it touches in full.
3. Hunt every angle of the layout at full aggression, with the rule documents ([step 02](02-rules.md)), the focus note and the spec when one was found. A candidate costs nothing and dies at the gate; do not hold one back because you already have enough.

Write the candidates down before judging any, a section per angle, explicitly empty when it found nothing ("angle 2: nothing"). Per candidate: `file:line`, angle, `root` (the symbol where the defect originates), summary, mechanism (initiator → path → effect as far as you know); angles 6, 10, 13 add `rule`, the verbatim quote of the rule; angle 15 adds [`spec_quote`](../angles/15.spec.md#spec_quote). No quote: no candidate.

Drop, without judging: a contradiction of a recorded decision from facts and decisions ([prepare](01-prepare.md#facts-and-decisions)); an evidence line that exists in the base (`git show <base>:<file>`) inside a function the diff did not touch.

## Judge yourself

Judge every candidate by the gate files listed in the steps of the layout (`gates/bugs.md`, `gates/shape.md`, `gates/severity.md`, whichever it prints). You found these candidates, so you share their blind spots: ask the self-check of `gates/bugs.md` literally before each bug `CONFIRMED`, and refute with a quoted line, not with doubt.

Per candidate record the fields a judge returns: verdict, severity, `severity_class`, `severity_gate` when a gate cut it, `blocks` for a blocking finding, angle, category, a one-sentence summary with the evidence.

## Second model, only for Important

No `CONFIRMED` `Important` after your own gates: no subagent. The output says `judge: inline only (no Important candidate)`.

One or more: spawn **one** judge subagent for all of them, role `verifier`, on the model the layout prints next to your model (`your model opus → judge sonnet`), with the tier and effort it prints. Brief, in this order: the command that prints the diff, the Important candidates with your evidence, the project's severity sections verbatim ([source](02-rules.md#severity-source)), facts and decisions, then paths only: the gate files of these candidates' classes (`<skill>/gates/bugs.md` for bug angles, `<skill>/gates/shape.md` for the rest, `<skill>/gates/severity.md` always) and the role template `<root>/skills/jig/references/roles/verifier.md`. Never paste the gate text; the judge reads the files itself.

Run it in the foreground, or in the background and continue on its completion notification. Never `sleep` and never poll its output.

**The judge's verdict stands.** `CONFIRMED` by it: the item carries "two models" (you and the judge). `REFUTED`: the candidate goes to the refuted list with the judge's reason; when you still hold a quoted line it ignored, name the disagreement in the output instead of overruling it. A severity it lowered stands with its `severity_gate`.

## Deepening

The layout prints `deepening:`: spawn the deepener as [selector](../references/selector.md#deepening) describes. Otherwise none.

Then [rank](06-rank.md).
