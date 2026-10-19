---
type: flow
arm: with
---

Steps of `skills/jig/flows/bug-fix.md` and `flows/mr.md`. `evidence` matches a tool call (`<tool> <input as JSON>`, one per line); `skip` matches the trace or the reply. The last step also counts as skipped when the agent says the repo has no remote.

```json
[
  {
    "step": "2 use case",
    "evidence": "agent-view\\s+act\\s+(?:list|save-use-case)\\b|agent-view:act-decider",
    "skip": "skip:[^\\n\"`]{0,80}(?:agent-view|UI)"
  },
  {
    "step": "7 regression test",
    "evidence": "^(?:Write|Edit|MultiEdit) \\{.*?\"file_path\":\"[^\"]*\\.(?:test|spec)\\.[jt]sx?\"",
    "skip": "skip:[^\\n\"`]{0,100}(?:test|loop)"
  },
  {
    "step": "10 own review",
    "evidence": "\"skill\":\"(?:jig:)?jig-review\"|jig-review[\\\\/]+SKILL\\.md"
  },
  {
    "step": "10 pre-mr or skip",
    "evidence": "jig(?:\\.mjs)?\\S{0,2}\\s+(?:pre-mr|skip-verify)\\b",
    "skip": "skip:[^\\n\"`]{0,100}(?:merge request|remote|\\bMR\\b)|\\bno (?:git )?remote\\b"
  }
]
```
