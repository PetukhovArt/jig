---
"jig": patch
---

`jig-review` posting routes a finding on an unchanged line of a diff file, and an `Important` outside the diff without `caused_by`, to a resolvable discussion with the chip first and `file:line` after the body, not to the FYI note. The FYI note holds only `Nit` and `Pre-existing` findings outside the diff, and the confirmation flags an `Important` or a diff file routed there. (#22)
