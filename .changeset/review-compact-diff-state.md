---
"jig": minor
---

The written diff and the state read cost less.

- Diff parts keep one `=== <path>` line per file (with `new`, `renamed from`, `binary`) instead of `diff --git`, `index`, `---` and `+++`; a deleted file is one line with its line count; lock files, minified files, source maps and snapshots are not written, and `index.txt` names them.
- `jig review state <path>` prints a state in a few lines without the comment bodies; steps read it instead of the JSON.
