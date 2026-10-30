---
"jig": patch
---

`jig review-cycle head <mr>` compares the forge head with the state's `last_reviewed_sha`; the review checks the head with it before verify (lean layout included) and at the end, the review runner returns a `head:` line, posting refuses a moved head unless acknowledged, and the review cycle runs a follow-up round on the increment first, so a push during a review no longer goes unnoticed (#28).
