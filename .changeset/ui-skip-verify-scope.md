---
"jig": patch
---

`jig skip-verify` no longer waives `ui-reuse` and `ui-mockup`: they need no running app, so `jig pre-mr` keeps asking for them after a skip and says why.
