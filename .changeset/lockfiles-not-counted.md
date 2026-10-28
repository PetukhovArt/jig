---
"jig": patch
---

`jig review-plan` leaves lock files (`package-lock.json`, `Cargo.lock`, `uv.lock` and the rest of jig's lock file list) out of the counted lines, so a regenerated lock file no longer picks the layout or the number of finders; the diff parts skip the same list. (#23)
