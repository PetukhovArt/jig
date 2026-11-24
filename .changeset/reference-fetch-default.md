---
"jig": minor
---

With `ui.reference.fetch` set, `jig ui reference add` fetches and attaches the reference itself (`--no-fetch` skips it) and records `ui-reference:<n>`; `attach --tree` is refused then, so the tree always comes from the configured source. Flows `feature`, `bug-fix` and `ui` say that whether the app can run does not decide `jig ui scope`.
