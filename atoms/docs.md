---
name: docs
description: "Apply when writing, editing or reviewing a Markdown document (README, docs, ADR, glossary). A document earns its place by saying what the code cannot; every claim in it must match the code today."
paths: ["**/*.md"]
---
# Docs

- A doc exists only if it says what the code cannot: intent, decisions and their reasons, how to run things, terms of the domain.
- A claim that restates the code drifts; delete it or link to the code.
- Every claim must hold today. A claim that no longer matches the code is a bug in the doc.
- An ADR records one decision that was hard to reverse, its context, the options and why the others lost. A routine choice is not an ADR.
- A glossary term has one meaning across the code, the docs and the conversation. Synonyms for one concept are a finding.
- Instructions for agents follow the same rules plus one: every line must change what the agent does.
