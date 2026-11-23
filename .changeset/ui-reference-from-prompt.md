---
"jig": minor
---

With a `ui` profile, the `user-prompt-submit` hook declares the branch reference `figma:<url>` when the prompt holds a Figma `/design/` or `/file/` URL with a `node-id` and the branch has no declared reference yet, and tells the agent that the UI part follows `flows/ui.md` and that `jig pre-mr` will ask for `jig ui mockup --figma <url> --component <node id>` and `jig ui reuse`. An agent that never ran `jig ui mockup` is now asked for the `ui-mockup` proof anyway; a declared reference is never overwritten.
