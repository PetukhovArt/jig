# Re-review

Mode `review` only. Mode `pre-mr` never re-reviews.

## Re-review

On when the state file exists ([state](03-state.md)), whether or not `last_reviewed_sha` is still an ancestor of HEAD. Unavailable with `--no-state`.

**Plan the round from the state, not from shas.** `<base>` is the current base from [prepare](01-prepare.md):

```
node "<root>/bin/jig.mjs" review-plan <base> --rereview --state <state path> --mr
```

It compares content, so a rebase or a base merged into the branch costs nothing, and prints one `re-review scope:` line:

- `unchanged`: the merge request's diff hashes to `diff_hash` and the working tree is clean. Only the [developer's replies in threads](#developer-replies-in-threads) can have moved: fetch **only** them and stop. Scope, outcome check, symbol search and finder spawns are skipped. No new replies and no thread whose last note is the developer's without a [reply](#reply-to-every-reply) yet: the run ends with no findings. Such threads exist: the outcome check runs on them only. Someone wrote under my FYI note after my last note there: the [optional items](#optional-items) are rechecked too.
- `patches`: the files of the merge request whose patch against the base changed since the last review, each with the branch's own changed lines (`+a -d`). The plan below it (finders, layout, `diff:`, diff parts) is planned on exactly these files and lines. Empty: the branch has no new work; only the outcome check runs. A file renamed since the last review is compared with the reviewed patch of its old path, so a move with small edits counts only the lines that differ; the line ends with `renamed since the last review: <old> → <new>, …`, and the [outcome check](#outcome-check) looks for a finding recorded on an old path at its new path first.
- `full (<reason>)`: the state cannot say what was reviewed (`base_sha` or `last_reviewed_sha` missing locally, or `diff_hash` does not match their range). Every file of the merge request is in scope; say so in the summary.

**The short path's tally is not zero.** Every finding with an open thread (status not `fixed`, not `no_change_needed`, not `optional`) enters `prior_*`: rechecked by a reply with its new outcome, the rest with their carried status (`open` and `skipped` → `prior_skipped`, `unverified` → `prior_unverified`). The diff did not change, so the defect stands. The sum is the one in the [convergence check](08-output.md#write-state). One run on this path reported `prior_skipped: 4`, another zeros, and the zeros blocked the merge request.

### Why patches

A rebuild (rebase, cherry-pick onto a new base, amend) changes the sha of every commit and leaves the branch's own work byte for byte, and a merge of the base into the branch brings the base's hunks into `<last_reviewed_sha>..HEAD`, often into the merge request's own files. Neither is the author's new work. The patch of a file against its base (`git diff <base>...HEAD -- <file>`) holds only the branch's change, so comparing it with the reviewed patch (`git diff <base_sha>...<last_reviewed_sha> -- <file>`) leaves exactly the new work; jig counts the changed lines that differ between the two, so moved hunk headers count nothing. A file whose only difference is moved hunk headers has no new work and stays out; the outcome check still reads the tree wherever the code now lives.

Summary: `scope: patches, N of M files` (or `unchanged`, or `full (<reason>)`).

### Round rules

- **Scope = the files `review-plan --state` printed**, plus uncommitted changes. Only files of the merge request can be in it: the forge rejects a comment on a line outside the merge request, so a finding there would reach nobody whatever the verdict.
  **The link to your code is not lost:** the right to a finding is cut, not the right to read. A foreign file that broke your call goes into a finding as evidence, and the finding sits on your line, which is in the merge request.
  The layout `review-plan --state` printed is the layout on THIS scope: the budgets count from the branch's own changes. Under 600 counted lines it plans one finder for every angle and no deepening: a re-review is the outcome check plus a look at the new range, and a full layout on seven fix commits cost almost a first run. From 600 lines the range is new work and gets the full layout. Code reviewed earlier outside it is not reread for new findings, with one exception: the hunks of the whole merge request in its dependency manifests (`git diff <base>...HEAD -- <manifest files>`) are checked every round for [a dependency nothing uses](../angles/13.architecture.md#section-a-universal-rules-always-on), since a later commit can remove its last use. The scope limits **only new findings**: the outcome check reads the tree wherever the code now lives.
- **Only Important on fix hunks.** A fix hunk (defined below) is the author's answer to an earlier finding: new Nit and Pre-existing on it are suppressed, and a counter remains in the summary. A hunk the map linked to nothing is new work (a new module or function in a fix commit): severity by the general rules, Nits are printed as in round 1. Otherwise code that first appeared after round 1 never gets a Nit.
- **Lifting `blocks`.** The outcome check for earlier blocking findings ([verify](../gates/severity.md#blocking-finding)) runs before the finders spawn: the scope depends on it. A finding became `fixed` or `no_change_needed` → the files of its `blocks` and the file the code moved to (the outcome check found it) enter the scope with the full patch of the merge request (`git diff <base>...HEAD -- <file>`), not the delta, and their hunks count as new work even when the map linked them to the finding. Nits in those files were muted under rework ([ranking](06-rank.md)); the move to `fixed` happens once, and this is the only round where they can be read. Summary: `lifting blocks: N files with the full patch`.
- **Triage before the judges.** A candidate on a fix hunk whose severity ceiling is `Nit` anyway ([severity](../gates/severity.md)) is doomed in this round: judging it pays for a known verdict. Drop it before clustering, by angle and line, without reading code: cleanup (angles 7, 9, 11, 16, 17) and any documentation finding. Exceptions stay and are judged: a memory leak of angle 8, an ownership break of angle 13, a wrong test of angle 16 and a wrong comment of angle 17 can be `Important`. The dropped go into `suppressed_nits`.
- **A fix-regression brief** goes to every finder: for hunks answering an earlier finding, apply angle 2 to the fix itself (did it drop a neighbouring rule?) and angle 12 (did the fix add a guard whose rule also holds in places the fix did not touch?).
- **A higher bar on fix hunks.** A run is a round: round 1 reviews the author's work, each next one reviews the author's answer to me. A **fix hunk** is one the fix-hunk map linked to an earlier finding: it touches that finding's file on or near its code, and the edit matches what the finding asked for. On a fix hunk a new finding survives only as `CONFIRMED` Important; a `CONFIRMED` Nit is dropped, from any angle. Hunks the map linked to nothing keep the normal gate, even in the same file.
- **Stop at round 4.** Rounds 2 and 3 already worked through the author's answers: what was not confirmed in three rounds is held by persistence, not code. With `runs >= 3` in state for this key and no `CONFIRMED` Important in the current round: report zero and say the review converged; the remaining Nits are not printed as findings. A `CONFIRMED` Important is always printed, in any round: the stop mutes the tail of small things, not a proven defect. The stop applies to fix hunks: new work and files with lifted `blocks` are judged as in round 1. The outcome check still runs: standing findings still get a status.
- **Suppression is never silent.** Every candidate cut by the round bar or the stop is counted: one prose line in the summary ("suppressed by the round bar: 3 nit (correctness×2, efficiency×1)") and `"suppressed_nits": N` in the machine line. Their texts are neither printed nor written to state.

## Outcome check

Runs on a re-review, and on a first run with [adopted threads](03-state.md#adopting-your-own-threads).

One subagent takes every finding whose thread is unresolved (`open`, `skipped` or `unverified` from any earlier run) plus the current tree, and returns **exactly one status per finding: as many out as went in**.

**The count line is derived from the per-finding list**, by counting its lines, and never written separately. They diverged once: 26/10 in the list against 28/8 in the count line.

**A thread reply is not written to state.** Neither `outcome_reply` nor any field outside the [schema](../references/state-schema.md): the reply text comes back with `discussion_id` in the output ([item 5](08-output.md#output)), and posting takes it from there.

**The role by thread content.** No taken thread has someone else's reply → role `outcome-checker`: the input is a closed list, there is physically nothing to skip, and an undercounted status is caught by the convergence check ([output](08-output.md)). At least one developer reply → role `verifier`: the [reply review](#developer-replies-in-threads) judges an argument against the code and writes a learning that outlives this merge request. The threads were fetched during [adoption](03-state.md); check the condition on them, without another request.

- `fixed`: the defect is gone; name the code that closed it.
- `no_change_needed`: the finding was wrong or lost its point; say why.
- `skipped`: the defect stands; **quote the line it stands on, at its current path**. No quote, no verdict.
- `unverified`: the check could not run: the symbol is not found, the file is gone, only part of a multi-place finding can be located, the argument needs domain knowledge the code does not hold. List where it searched.

**Locate first, judge second.** A finding's `file:line` records where it was found, not where it lives now: a fix often moves code to another file. Search the symbol across the whole tree and read the commits in scope before any conclusion: an empty line at the anchor proves nothing, and a vanished file is not a fixed defect.

## Developer replies in threads

For findings with `discussion_id`, the outcome check first fetches the replies in the thread.

### The reply claims a fix

"unified through X" → check the claim **against the code, not the reply**. Classify by what the code shows. The code confirms the fix only partly → `skipped` or `unverified` and a [reply in the thread](#reply-to-every-reply).

### The reply disputes the finding

Judge by the code.

**The argument holds** (the code confirms the intended contract or the absence of risk) → `no_change_needed`, with the confirmed argument as the reason; posting resolves the thread. The same subagent (it holds both the argument and the code) returns a **learning**: one sentence in the form of a skip rule "do not flag <mechanism> in <context>: <fact confirmed by the code>", with the mechanism and the scope named, never a bare "do not flag <topic>". Append it to the learnings file (`source` = merge request and thread, `date` = today). In the summary, propose it as a line for the project's review document so a human commits it for the whole team.

**The argument does not hold** → the finding stays `open`; compose a counter-reply. The [comment text](07-comments.md) rules apply, in the same form as the finding's own comment: architectural Important → expanded, up to 10 lines (the author may be leading away from the right architecture; answer firmly and fully); everything else → short, up to 350 characters. Always symbol references plus a quote of the code that contradicts the argument. Posting sends it to the thread.

**One counter-reply per finding, ever.** My reply is already the last in the thread and the developer disputes again: do NOT answer: mark "dispute: needs a human" in the summary and leave the thread to a human.

### Partial fix

Some places of a multi-place finding are fixed → `skipped` with the remaining places listed. The thread stays open; the next run checks again. The developer replied in the thread → a [reply](#reply-to-every-reply) with the list of remaining places.

### Reply to every reply

The last note of an unresolved thread is the developer's and the outcome is not `fixed` / `no_change_needed` (the thread is not resolved) → compose a reply. A silent `skipped` on "fixed" leaves the developer sure that all is done and the merge request hanging without an explanation.

- `skipped` → what remains: the symbols and a quote of the line the defect stands on now. Name the closed places in one phrase, so it is visible they were checked.
- `unverified` → what could not be checked and what is needed to decide: a reproduction, a run, an answer to a question.
- `open` after a dispute → the counter-reply above.

Form and limits as for a counter-reply. The reply returns in the output with its `discussion_id`; posting sends it. My note is already the last in the thread → do not reply: the developer has not answered it yet, unless a commit answered it ([below](#an-important-that-stands-after-a-new-commit)).

### An Important that stands after a new commit

The developer may answer with a commit and no note: they push, ask for review again and wait. Silence on such a thread leaves them waiting on a review that already decided. Reply once when all hold:

- the finding is `Important` and its outcome in this run is `skipped`;
- my note is the last in its unresolved thread;
- this run's range has new commits (not the [short path](#re-review)), and the newest of them (`git log -1 --format=%cI HEAD`) is later than my last note in the thread.

The reply, in the comment language, short ([comment text](07-comments.md)): ``after `<short sha of HEAD>` the defect stands: `<the line it stands on, at its current path>` ``, with that `file:line`; at most one more sentence naming what the commit did not change. Nit and Pre-existing stay silent: they never hold the merge request. The reply makes my note the last again and later than the commit, so the same head never gets a second one.

## Optional items

`optional` findings have no thread and no status of their own; the FYI note shows them as a checklist ([posting](../references/posting.md#8-the-fyi-note-one-per-merge-request)). A re-review rechecks the ones not yet `done` when this run's range has new commits, or when someone wrote under my FYI note after my last note there (the threads read in [adoption](03-state.md) hold it). The subagent of the outcome check gets them as a second list, apart from the findings (no finding to check: role `outcome-checker` with this list alone): per item `done` (name the code that did it) or `not done`. `done` → `"done": true` on the finding in state. They never enter the count line or `prior_*`.

Someone wrote under the FYI note → one short answer there, in the comment language: what is now ticked, and for an item the writer called done but the code does not show, the line that still stands. It returns in the output as the FYI answer with the note's `discussion_id`; posting sends it and rebuilds the note with the ticks.
