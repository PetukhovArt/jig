---
type: regex
target:
  source: files
  exclude: ['**/*.md']
match: not_contains
pattern: '^\+(?!\+\+).*(?:eslint-disable|@ts-ignore|@ts-expect-error)'
flags: m
arm: both
---
