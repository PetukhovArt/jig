---
"jig": patch
---

A tool or check that times out is ended with its whole process tree (`taskkill /T` on Windows, the process group elsewhere), and the run settles shortly after the tool exits even when a grandchild still holds its output, so the stop hook reports the timeout at once instead of hanging. (#15)
