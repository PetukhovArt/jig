---
name: automate-repeats
description: "Apply to any non-trivial edit, migration, analysis or check. Build the tool that does it or proves it (codemod, script, generator) instead of working by hand; the tool is the artifact a reviewer can rerun."
---
# Automate repeats

- Do one unit by hand to learn the shape. Then write the codemod or script, run it, and diff its result against your hand-made unit.
- Ten similar edits by hand is a signal you skipped the automate-repeats.
- An analysis ("which callers still use the old API") is a script whose output you paste, not a list you typed.
- Keep the automate-repeats in the merge request or in the description so the reviewer can rerun it.
- If you name this atom as the reason for a decision and the diff has no script, codemod or generator, you did not apply it.
