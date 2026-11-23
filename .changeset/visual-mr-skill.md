---
"jig": minor
---

New skill `jig-visual-mr` writes and publishes the merge request description from the jig template, on its own or from the `mr` step: it asks which merge request to take when several match the branch, keeps hand edits, and reads the description back after publishing. The Evidence block says in plain words how and where the change was checked, then Before and After; it no longer carries the `jig pre-mr` verification level, the command list or the break-it line.
