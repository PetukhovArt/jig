# Posting

Mode `review` only, with `--post` or an explicit request. Commands per host: `<root>/skills/jig/references/forge.md` (which host, then the rows named below). Every command runs inside the repository of the merge request.

**Token discipline.** The merge request diff is never read into the context to compute positions by eye: take the line numbers from `git diff -U0 <base_sha>...<head_sha> -- <file>` hunk headers for the file at hand, and write every body and payload to a temp file. Never `-f body=` or `--body` inline: quoting breaks the text, and `glab` does not expand `@file` (the local path would land in the merge request).

**Files of one pass** go under `<main checkout>/.jig/runs/review/payloads-<mr>-<head8>/` (`<head8>`: the first 8 characters of `head_sha`): the payloads and `manifest.json`. The head in the name makes a file of an earlier pass unreachable: a stale diff would route every finding on a new hunk to the wrong side of the scope line.

With `--post`, step 6 is skipped: the flag IS the confirmation.

## 1. Reconcile with the forge

**The forge is the source of truth; state is a cache.** Read your threads ("Read its threads"). A finding without `discussion_id` whose `file:line` (then the first line of its body) matches an open thread of yours gets that thread's id. Without this, a finding whose id was lost posts a second time, and its thread never resolves. Back up the state file before writing it.

## 2. Postable set

Postable = `open` and not yet posted (no `discussion_id`), plus **all** `optional` items, earlier ones included, plus the state's `deepening` when present: the note is rebuilt from the whole set, and an update without the old items would erase them.

**The postable set comes from the state file, always.** A caller's brief never lists new findings; the replies, resolves and FYI answer it names come on top of the postable set and never narrow it. `node "<root>/bin/jig.mjs" review state <state>` prints its size as `postable: N open without a thread · K optional · deepening yes|no`. One re-review posted only its reply, reported `threads 0/0`, and left its new findings and the FYI note unposted until it was sent back.

**Hold ids.** A caller may name finding ids to hold back (a review cycle holds spec findings whose quote is not in the spec). They leave the postable set before routing: not posted, not in the note, not counted.

## 3. Head and routing

Read the merge request's diff refs ("Diff refs" row): `base_sha`, `start_sha`, `head_sha`.

**The head must be the reviewed one.** `head_sha` differs from the state's `last_reviewed_sha` (`node "<root>/bin/jig.mjs" review-cycle head <iid>` prints `MOVED`): post nothing and report `head moved: <reviewed8> → <head8>, N commits`. The author pushed after the review: its findings, replies, FYI answer and line numbers may already be false, and the caller runs a follow-up round on the increment first. Post anyway only when the user (or the caller's brief) acknowledges the moved head in so many words; then every finding is re-anchored on the new head as in step 5.

For each postable finding:

- the file is in the merge request diff and the line is an added or context line of the new side → a **thread** on `file:new_line`;
- the file is not in the diff, and `caused_by` holds: its `file` is in the diff, its `diff_line` appears verbatim among that file's added or removed lines, and its `victim_line` appears verbatim in the affected file of the reviewed tree → a **promoted** thread on the cause line; its body ends with one line naming the affected `file:line`;
- the file is in the diff, the line is not (unchanged code outside every hunk) → a **discussion**: a general thread, resolvable, with the chip on the first line and the `file:line` line after the body;
- the file is not in the diff, no `caused_by`, and the finding is `Important` → a **discussion** as above: a blocking finding always gets something the author resolves and a review cycle counts by its chip;
- otherwise (a `Nit` or `Pre-existing` outside the diff) → an item of the **one FYI note** (step 8). `optional` findings and the `deepening` go there too, wherever their file is.

The FYI note never holds an `Important` and never a finding on a file of the diff. One run routed a confirmed Important on an unchanged line of a diff file to the note: the author could miss it, nobody could resolve it, and the review cycle did not count it as open.

Routing is the scope gate: you do not decide it per finding, and nothing is filtered before it. A suggestion block becomes a one-line replacement of the anchored line.

**The chip stays on the first line.** Every thread body starts with the finding's severity chip (`**[🔴 Important]**`, `**[🟡 Nit]**`, `**[🟣 Pre-existing]**`), as [comment texts](../steps/07-comments.md) write it. A prefix of your own (a `file:line` for a thread the forge refused to position) goes after the body, never before it: a review cycle reads an optional thread off the forge by the chip of its opening note, and a thread whose first line is a path counts as a blocking one.

## 4. Manifest

Write `manifest.json` before posting anything: one entry per item, threads, promoted and discussions first, then at most one FYI entry.

```json
[{ "i": 0, "kind": "thread", "file": "src/a.ts", "line": 43, "anchor": null, "positioned": true, "payload": "<abs path>", "preview": "**[🔴 Important]** …" },
 { "i": 1, "kind": "promoted", "file": "src/b.ts", "line": 9, "anchor": "src/a.ts:12", "positioned": true, "payload": "<abs path>", "preview": "…" },
 { "i": 2, "kind": "discussion", "file": "src/a.ts", "line": 304, "anchor": null, "positioned": false, "payload": "<abs path>", "preview": "**[🔴 Important]** …" },
 { "i": "fyi", "kind": "fyi", "count": 2, "optional": 1, "deepening": true, "payload": "<abs path>", "items": [{ "file": "src/c.ts", "line": 116, "reason": "no caused_by" }] }]
```

`count` is the out-of-diff `Nit` and `Pre-existing` items, `optional` the simplifications, `deepening` whether the note carries the proposal. The manifest is the posting contract: the confirmation (step 6) prints it, posting fires it, the report counts against it. A manifest with only an FYI entry posts no thread: a caller reading it knows the pass returned nothing to the developer.

## 5. Threads, never flat notes

**Findings post as positioned threads** ("Post a new thread"), never as general notes: a general note has no position, cannot be resolved, and the next outcome check does not see it. A general note is used exactly twice: the one FYI note, and a reply inside an existing thread ("Reply in a thread"). A finding with no line to anchor on (a `discussion` of step 3) posts as a general thread (a discussion, not a note), chip first, `file:line` after the body. The forge rejects the position (the line left the diff): find the line again in the current head by its quoted code or symbol, re-anchor and post **once**; still rejected, post it as a general thread (a discussion, not a note) with the `file:line` line after the body. Not found at all: do not post a flat note; set `status: "unverified"` and list it in the summary as "not posted: the line moved", so the next run checks again.

## 6. Confirm

Print one line per manifest entry: `n · file:line · thread | promoted (anchor) | discussion | fyi · preview (≤80)`. An FYI item that is `Important`, or whose file is in the diff, is a routing error: print it as `ROUTING: <file:line> Important in fyi` (or `diff file in fyi`), route it again by step 3 and print the manifest again. Wait for the user's explicit confirmation. No auto-posting.

## 7. Post and read back

Post each entry from its payload file. A 201 proves nothing about the body: read every created note back: the body is not empty, does not start with `@`, contains no local absolute path, and a thread is a thread (positioned, or a general discussion after a refused position). A bad body: fix it in place ("Update a note"), do not post again. A dropped connection or timeout: look for the note first, repeat only when it is missing.

**Every finding became a thread.** List your own general notes other than the FYI note: each is a mis-posted finding. Delete it and post it again from its manifest payload.

## 8. The FYI note: one per merge request

One unresolvable general note, rebuilt whole on every pass, sections without items left out:

- `**Outside the merge request scope**`: noticed during review, fix when the change is small; no resolve needed. One item per out-of-diff `Nit` or `Pre-existing` finding: `` `file:line` `` and the first line of its `mrComment` without the chip;
- `**[🟡 Nit] Improvements: optional, not blocking the merge.**`: one item per `optional` finding, naming the file: `- [x]` when it is `done` in state, `- [ ]` otherwise;
- `**Deepening: a proposal, not a finding.**`: the state's `deepening` as one item, `module · what to deepen · effect · blast radius`.

The heading lines are in the comment language. Find your earlier note by the invisible marker `<!-- review-fyi -->` at its end and update it ("Post or update a general note"); create one only when none exists. Keep the marker: without it every pass leaves another note.

## 9. Write back to state

Write the id of each created thread into its finding (`discussion_id`). That keeps the next posting from duplicating findings and lets a later run resolve the threads.

After a re-review, also:

- **resolve** the threads of findings whose outcome became `fixed` or `no_change_needed` ("Resolve a thread"). Never resolve a thread you did not open;
- **post the replies** of the outcome check into their threads, and the FYI answer under the FYI note ("Reply in a thread" with the note's discussion), each body from a file.

## 10. Report

`postable: <the state's postable line> · positioned: P/M · threads: T/M · verified: V/C · discussion ids written: N/M` (M = thread, promoted and discussion entries of the manifest; M plus the FYI items is the state's `open without a thread` minus the hold ids), the unmatched `file:line` when N < M, and each resolve or reply as `OK` or `ERR <first 300 characters of the answer>`. N < M is a torn state: write the ids back again (step 1 finds them) before anything else, since a lost id disables both duplicate protection and thread resolution on every later run.
