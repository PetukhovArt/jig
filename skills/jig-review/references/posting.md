# Posting

Mode `review` only, with `--post` or an explicit request. Commands per host: `<root>/skills/jig/references/forge.md` (which host, then the rows named below). Every command runs inside the repository of the merge request.

**Token discipline.** The merge request diff is never read into the context to compute positions by eye: take the line numbers from `git diff -U0 <base_sha>...<head_sha> -- <file>` hunk headers for the file at hand, and write every body and payload to a temp file. Never `-f body=` or `--body` inline: quoting breaks the text, and `glab` does not expand `@file` (the local path would land in the merge request).

**Files of one pass** go under `<main checkout>/.jig/runs/review/payloads-<mr>-<head8>/` (`<head8>`: the first 8 characters of `head_sha`): the payloads and `manifest.json`. The head in the name makes a file of an earlier pass unreachable: a stale diff would route every finding on a new hunk to the wrong side of the scope line.

With `--post`, step 6 is skipped: the flag IS the confirmation.

## 1. Reconcile with the forge

**The forge is the source of truth; state is a cache.** Read your threads ("Read its threads"). A finding without `discussion_id` whose `file:line` (then the first line of its body) matches an open thread of yours gets that thread's id. Without this, a finding whose id was lost posts a second time, and its thread never resolves. Back up the state file before writing it.

## 2. Postable set

Postable = `open` and not yet posted (no `discussion_id`), plus **all** `optional` items, earlier ones included: the note is rebuilt from the whole set, and an update without the old items would erase them.

**Hold ids.** A caller may name finding ids to hold back (a review cycle holds spec findings whose quote is not in the spec). They leave the postable set before routing: not posted, not in the note, not counted.

## 3. Head and routing

Read the merge request's diff refs ("Diff refs" row): `base_sha`, `start_sha`, `head_sha`. For each postable finding:

- the file is in the merge request diff and the line is an added or context line of the new side → a **thread** on `file:new_line`;
- the file is not in the diff, and `caused_by` holds: its `file` is in the diff, its `diff_line` appears verbatim among that file's added or removed lines, and its `victim_line` appears verbatim in the affected file of the reviewed tree → a **promoted** thread on the cause line; its body ends with one line naming the affected `file:line`;
- otherwise → an item of the **one FYI note** (step 8). `optional` findings go there too, wherever their file is.

Routing is the scope gate: you do not decide it per finding, and nothing is filtered before it. A suggestion block becomes a one-line replacement of the anchored line.

**The chip stays on the first line.** Every thread body starts with the finding's severity chip (`**[🔴 Important]**`, `**[🟡 Nit]**`, `**[🟣 Pre-existing]**`), as [comment texts](../steps/07-comments.md) write it. A prefix of your own (a `file:line` for a thread the forge refused to position) goes after the body, never before it: a review cycle reads an optional thread off the forge by the chip of its opening note, and a thread whose first line is a path counts as a blocking one.

## 4. Manifest

Write `manifest.json` before posting anything: one entry per item, threads and promoted first, then at most one FYI entry.

```json
[{ "i": 0, "kind": "thread", "file": "src/a.ts", "line": 43, "anchor": null, "positioned": true, "payload": "<abs path>", "preview": "**[🔴 Important]** …" },
 { "i": 1, "kind": "promoted", "file": "src/b.ts", "line": 9, "anchor": "src/a.ts:12", "positioned": true, "payload": "<abs path>", "preview": "…" },
 { "i": "fyi", "kind": "fyi", "count": 2, "optional": 1, "payload": "<abs path>", "items": [{ "file": "src/c.ts", "line": 116, "reason": "no caused_by" }] }]
```

`count` is the out-of-diff items, `optional` the simplifications. The manifest is the posting contract: the confirmation (step 6) prints it, posting fires it, the report counts against it. A manifest with only an FYI entry posts no thread: a caller reading it knows the pass returned nothing to the developer.

## 5. Threads, never flat notes

**Findings post as positioned threads** ("Post a new thread"), never as general notes: a general note has no position, cannot be resolved, and the next outcome check does not see it. A general note is used exactly twice: the one FYI note, and a reply inside an existing thread ("Reply in a thread"). The forge rejects the position (the line left the diff): find the line again in the current head by its quoted code or symbol, re-anchor and post **once**; still rejected, post it as a general thread (a discussion, not a note) with the `file:line` line after the body. Not found at all: do not post a flat note; set `status: "unverified"` and list it in the summary as "not posted: the line moved", so the next run checks again.

## 6. Confirm

Print one line per manifest entry: `n · file:line · thread | promoted (anchor) | fyi · preview (≤80)`. Wait for the user's explicit confirmation. No auto-posting.

## 7. Post and read back

Post each entry from its payload file. A 201 proves nothing about the body: read every created note back: the body is not empty, does not start with `@`, contains no local absolute path, and a thread is a thread (positioned, or a general discussion after a refused position). A bad body: fix it in place ("Update a note"), do not post again. A dropped connection or timeout: look for the note first, repeat only when it is missing.

**Every finding became a thread.** List your own general notes other than the FYI note: each is a mis-posted finding. Delete it and post it again from its manifest payload.

## 8. The FYI note: one per merge request

One unresolvable general note, rebuilt whole on every pass, sections without items left out:

- `**Outside the merge request scope**`: noticed during review, fix when the change is small; no resolve needed. One item per out-of-diff finding: `` `file:line` `` and the first line of its `mrComment` without the chip;
- `**[🟡 Nit] Improvements: optional, not blocking the merge.**`: one `- [ ]` item per `optional` finding, naming the file.

The heading lines are in the comment language. Find your earlier note by the invisible marker `<!-- review-fyi -->` at its end and update it ("Post or update a general note"); create one only when none exists. Keep the marker: without it every pass leaves another note.

## 9. Write back to state

Write the id of each created thread into its finding (`discussion_id`). That keeps the next posting from duplicating findings and lets a later run resolve the threads.

After a re-review, also:

- **resolve** the threads of findings whose outcome became `fixed` or `no_change_needed` ("Resolve a thread"). Never resolve a thread you did not open;
- **post the replies** of the outcome check into their threads, each body from a file.

## 10. Report

`positioned: P/M · threads: T/M · verified: V/C · discussion ids written: N/M` (M = thread and promoted entries of the manifest), the unmatched `file:line` when N < M, and each resolve or reply as `OK` or `ERR <first 300 characters of the answer>`. N < M is a torn state: write the ids back again (step 1 finds them) before anything else, since a lost id disables both duplicate protection and thread resolution on every later run.
