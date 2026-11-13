---
"jig": patch
---

OpenCode: the plugin runs jig with Node instead of the OpenCode binary, whose install path contains `node_modules`, so its hooks take effect; it passes the project directory as the hook's working directory instead of an environment variable.
