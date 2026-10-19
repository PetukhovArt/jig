---
type: flow
arm: with
---

Steps of `skills/jig/flows/feature.md` and `flows/mr.md`. `evidence` matches a tool call (`<tool> <input as JSON>`, one per line); `skip` matches the trace or the reply.

```json
[
  {
    "step": "3 use case",
    "evidence": "agent-view\\s+act\\s+(?:list|save-use-case)\\b|agent-view:act-decider",
    "skip": "skip:[^\\n\"]{0,80}(?:agent-view|UI|use case)"
  },
  {
    "step": "7 delegate",
    "evidence": "^(?:Agent|Task) (?!.*\"subagent_type\":\"agent-view:)"
  },
  {
    "step": "8 drive the app",
    "evidence": "agent-view\\s+(?:click|fill|key|drag|act\\s+replay|screenshot|snap|wait)\\b",
    "skip": "skip:[^\\n\"]{0,80}(?:agent-view|UI)"
  },
  {
    "step": "10 own review",
    "evidence": "\"skill\":\"(?:jig:)?jig-review\"|jig-review[\\\\/]+SKILL\\.md"
  },
  {
    "step": "10 pre-mr or skip",
    "evidence": "jig(?:\\.mjs)?\\S{0,2}\\s+(?:pre-mr|skip-verify)\\b",
    "skip": "skip:[^\\n\"]{0,100}(?:merge request|remote|\\bMR\\b)"
  }
]
```
