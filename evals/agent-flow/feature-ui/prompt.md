---
max_turns: 60
runs: 1
timeout_seconds: 1800
allowed_tools: [Read, Glob, Grep, Edit, Write, MultiEdit, Bash, Agent, Skill]
---

/jig Add a status filter (online / offline / all) to the camera list. It must survive a page reload.

When you are done, run `npm run ci > ci-result.log 2>&1; if [ $? -eq 0 ]; then echo "CI: PASS" > ci-result.txt; else echo "CI: FAIL" > ci-result.txt; fi`
