---
"jig": patch
---

`jig init` finds a marker config kept out of git (`.git/info/exclude` or `.gitignore`, outside ignored folders), so a locally excluded `stratum.config.jsonc` with a global `stratum-lint` reads as configured, and it no longer asks for `slots.dev` and `slots.install` when the config already has a `slots` section. (#7)
