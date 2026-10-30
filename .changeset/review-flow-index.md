---
"jig": patch
---
`jig review-plan` writes a flow index next to the diff parts (`index-flow.txt`): the changed files and their direct importers with imports, exports and flow sites by line (stores, watchers, lifecycle hooks, events, IPC, requests, timers, routes; TypeScript, JavaScript and Vue patterns, imports only for other extensions). The flow modeler builds the model from it instead of reading every diff part, and the cost estimate prices it so.
