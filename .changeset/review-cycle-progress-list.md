---
"jig": patch
---

While a `jig-review-cycle` pass runs, each turn that ends after a merge request finishes prints only the list of finished merge requests, one `<web_url> | <status>` line each, with no explanation or plan of the next step, so a looped cycle keeps its main context small. A turn in which no merge request finished prints nothing, so the same list is not repeated.
