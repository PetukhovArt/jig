---
"jig": minor
---

Slots, the demo video and the eval runner no longer know a specific app control tool. `jig slot new` writes ports into env files only: it no longer writes an `agent-view.config.json`, `slots.cdp` is ignored (with a `jig doctor` warning; move the port to a `slots.ports` entry), and `slot new`, `slot ls` and `slot show` print the slot's ports for whatever tool the model points at them. The `jig-video` skill has the model carry out the scenario with its own app control tool while `fv.mjs` records the screen (`record`, `mark`, `stop`); the built-in driver over a debugging protocol is removed, and a scenario's `do` items are now actions in words. A case's `ui_check` in the eval runner describes the scenario in words and names its own `drive` and `screenshot` commands; the runner passes `JIG_APP_PORT` instead of writing a tool config.
