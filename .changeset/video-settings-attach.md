---
"jig": minor
---

jig-video keeps the project's choices in `.jig/video.json` with a setup that tests them; any speech command through `tts` (`{text}`, `{out}`), with unchanged lines reused on a rerun; `fv.mjs attach` posts the video on the PR (`gh pr comment --attach`) or the MR (GitLab uploads API), or copies it to a folder; `fv.mjs say` voices one test line.
