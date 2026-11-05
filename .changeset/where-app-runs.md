---
"jig": patch
---

One rule in the `jig` skill says where the app runs: a single agent working in turn runs the dev server and the verify in its own checkout; a slot is taken only when another agent writes in that checkout at the same time. Flows and `jig-slots` point to it instead of always sending the UI proof and bug bash to a slot.
