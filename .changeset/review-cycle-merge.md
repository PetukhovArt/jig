---
"jig": patch
---

`jig review-cycle merge <mr> <keep> <duplicate>... --note <file>` merges duplicate threads: each duplicate of yours gets the note and is resolved, and its finding becomes `no_change_needed` with its thread kept. A state with a status outside the schema now names every bad finding, its status and the allowed set, and says the file was edited outside jig (#25).
