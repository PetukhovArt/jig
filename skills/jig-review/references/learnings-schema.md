# Learnings file schema

`<main checkout>/.jig/runs/review/learnings.json`: repository level, no KEY. Rules derived from disputes the developer won apply to every merge request of the repository.

```json
{
  "remote": "…",
  "learnings": [
    {
      "rule": "do not flag <mechanism> in <context>: <fact confirmed by the code>",
      "category": "correctness",
      "source": "merge request 42, thread <id>",
      "date": "2026-08-06",
      "active": true
    }
  ]
}
```

- **`rule`**: one sentence, a mechanism plus its scope. A bare topic ("do not flag retry") is invalid.
- **`category`**: the same slugs as findings; it drives how the rule applies ([state](../steps/03-state.md#learnings)): cleanup categories and `spec` → drop the candidate; `correctness` and `security` → only demote to Nit.
- **`active: false`** takes the rule out of play without losing its history. People edit this file by hand: never overwrite entries you did not add in this run.
- The file is local to the machine and lives under `.jig/runs/`, outside git. The durable home of a rule is the project's review document, so every added learning is also proposed as a line for that document in the summary.
