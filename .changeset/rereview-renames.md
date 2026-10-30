---
"jig": patch
---

`jig review-plan --rereview --state` follows renames: a file moved since the last review is compared with the reviewed patch of its old path, so a rename commit counts only the lines that differ instead of the whole file, the `re-review scope:` line names each rename and `diff:` shows the move as a rename (#29).
