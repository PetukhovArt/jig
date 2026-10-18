---
name: lessons-to-checks
description: "Apply when you catch yourself writing the same instruction a second time, or see a recurring correction or review finding. Encode the rule as structure (architecture, a type, a lint whose message names the fix, a test) instead of more text."
---
# Lessons to checks

- Fix at the highest level that works: architecture (one owner, one way, internals not importable), then a type, then a lint or hook whose error names the fix, then a test, and prose last.
- A new check proves itself: it fails on the real mistake that prompted it.
- When the fix is structural, use only the structural fix. The instruction was the symptom.
- A rule that needs judgment stays text: make it more prominent and add an example of the failure.
- A rule that a new check makes impossible leaves the prose.
- A review finding that repeats across merge requests becomes a constraint, not another thread.
