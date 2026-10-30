---
"jig": patch
---

`jig review route <state> <base_sha> <head_sha>` prints the posting route of every postable finding, so posting no longer decides it by hand: an `optional` item or the deepening in the FYI note is no longer flagged as a routing error, and a finding left without a thread after posting blocks the merge request in the review cycle instead of passing silently (#26).
