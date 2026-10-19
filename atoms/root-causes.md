---
name: root-causes
description: "Apply when debugging. Trace each symptom back to the first place the system went wrong and fix it there. A guard is a fix only when the state it handles is legitimate. If two fixes sharing one premise fail the same check, test the premise."
metadata:
  group: Proof
---
# Root causes

- Reproduce first. No reproduction, no fix: build a feedback loop that goes red on the bug.
- Ask "why" until you reach a wrong decision in the code, not a place where the wrong value merely shows up.
- Instrument instead of guessing: log or trace the value at each hop until you see where it first goes wrong.
- After a restart or reload, suspect persisted state (storage, cache, config, a stale build) before the code.
- A guard (null check, retry, clamp) is a fix only if the state it handles is legitimate. Otherwise find what produced the state.
- Fix every instance of the same mistake, not only the one reported.
- Two fixes that share a premise failed the same check: write the premise down and test it with an observation that would come out differently if it were false, before writing a third fix.
- A bug outside the main path, cheap to recover from, whose fix adds code: record it as a known risk instead. Exceptions: data loss or corruption, security, a broken system invariant.
