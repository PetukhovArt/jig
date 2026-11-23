---
"jig": minor
---

Flow `ui` replaces `ui-match`: it reads the project's `ui` profile, works from a reference (Figma, an image, an existing implementation, a text spec) or from the project's tokens and components, takes a reuse inventory before code, proves the change with `jig ui reuse`, `jig ui mockup` and `jig ui prove`, runs up to three rounds of the new read-only `ui-reviewer` role and asks about every deviation. `feature` and `bug-fix` hand their UI part to it, and `lessons-to-checks` turns a UI miss the user reports into an eval case and a check that starts in observe mode.
