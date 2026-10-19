# Posting

Mode `review` only, with `--post` or an explicit request. Commands per host: `<root>/skills/jig/references/forge.md` (which host, then the rows named below). Every command runs inside the repository of the merge request.

**Token discipline.** The merge request diff is never read into the context to compute positions by eye: take the line numbers from `git diff -U0 <base_sha>...<head_sha> -- <file>` hunk headers for the file at hand, and write every body and payload to a temp file. Never `-f body=` or `--body` inline: quoting breaks the text, and `glab` does not expand `@file` (the local path would land in the merge request).

With `--post`, step 5 is skipped: the flag IS the confirmation.

## 1. Reconcile with the forge

**The forge is the source of truth; state is a cache.** Read your threads ("Read its threads"). A finding without `discussion_id` whose `file:line` (then the first line of its body) matches an open thread of yours gets that thread's id. Without this, a finding whose id was lost posts a second time, and its thread never resolves. Back up the state file before writing it.

## 2. Postable set

Postable = `open` and not yet posted (no `discussion_id`), plus **all** `optional` items, earlier ones included: the optional note is rebuilt from the whole set, and an update without the old items would erase them.

## 3. Head and positions

Read the merge request's diff refs ("Diff refs" row): `base_sha`, `start_sha`, `head_sha`. For each postable finding:

- the file is in the merge request diff and the line is an added or context line of the new side → a **thread** on `file:new_line`;
- the file is not in the diff, and `caused_by` holds: its `file` is in the diff, its `diff_line` appears verbatim among that file's added or removed lines, and its `victim_line` appears verbatim in the affected file → a **thread on the cause line**, whose body names the affected `file:line`;
- otherwise → an item of the **one optional note**, section "Outside the merge request". `optional` findings go there too, section "[🟡 Nit] Improvements: optional, not blocking the merge", as `- [ ]` items.

Routing is the scope gate: you do not decide it per finding. A suggestion block becomes a one-line replacement of the anchored line.

## 4. Threads, never flat notes

**Findings post as positioned threads** ("Post a new thread"), never as general notes: a general note has no position, cannot be resolved, and the next outcome check does not see it. A general note is used exactly twice: the one optional note, and a reply inside an existing thread ("Reply in a thread"). The forge rejects the position (the line left the diff): find the line again in the current head by its quoted code or symbol, re-anchor and post **once**. Still not found: do not post a flat note; set `status: "unverified"` and list it in the summary as "not posted: the line moved", so the next run checks again.

## 5. Confirm

Print one line per item: `n · file:line · thread | cause thread (anchor) | note · preview (≤80)`. Wait for the user's explicit confirmation. No auto-posting.

## 6. Post and read back

Post each item from its payload file. A 201 proves nothing about the body: read every created note back: the body is not empty, does not start with `@`, contains no local absolute path, and a thread is positioned (or a general discussion when the forge refused the position and you fell back to a `file:line` prefix). A bad body: fix it in place ("Update a note"), do not post again. A dropped connection or timeout: look for the note first, repeat only when it is missing.

## 7. The optional note: one per merge request

Find your earlier optional note by the invisible marker `<!-- review-optional -->` and update it ("Post or update a general note"); create one only when none exists. Keep the marker in the body: without it every run leaves another note.

## 8. Write back to state

Write the id of each created thread into its finding (`discussion_id`). That keeps the next posting from duplicating findings and lets a later run resolve the threads. Report `discussion ids written: N/M`, and list the unmatched `file:line` when N < M.

After a re-review, also:

- **resolve** the threads of findings whose outcome became `fixed` or `no_change_needed` ("Resolve a thread"). Never resolve a thread you did not open;
- **post the replies** of the outcome check into their threads, each body from a file.

Report each call as `OK` or `ERR <first 300 characters of the answer>`.
