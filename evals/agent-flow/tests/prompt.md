---
max_turns: 60
runs: 3
timeout_seconds: 1800
allowed_tools: [Read, Glob, Grep, Edit, Write, MultiEdit, Bash, Agent, Skill, TodoWrite]
---

/jig Write tests for the filter parser.

When you are done, run `npm run ci > ci-result.log 2>&1; if [ $? -eq 0 ]; then echo "CI: PASS" > ci-result.txt; else echo "CI: FAIL" > ci-result.txt; fi`
