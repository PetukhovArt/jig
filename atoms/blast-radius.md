---
name: blast-radius
description: "Apply before you change code other code depends on. Find what the change could break outside the diff, name the one fact the change is safe because of, and prove that fact as far as the risk demands."
---
# Blast radius

- Ask what else reads, calls, imports, serializes or schedules what you change: callers, subscribers, persisted data, wire formats, timing, configuration.
- Look where search stops: library source, generated code, string keys, reflection, other repositories that consume the contract.
- Name the one fact the change is safe because of (for example "this call only drops entries that are already dead").
- Prove the fact up the ladder and say where you stopped: stated → `file:line` → failure path walked step by step → run (a script calling the real code) → reproduced in the app.
- A risky change gets its fact to "run" at least.
- A contract between client and server is reviewed with both sides in view.
- If the fact cannot be proven, the change is not safe yet: narrow it, guard it, or ask.
