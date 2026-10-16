---
type: llm
focus: files
arm: both
---

PASS if the change adds tests for src/shared/lib/filter-parser.ts that call parseFilter and assert its returned value for concrete inputs (field conditions, negation, quoted values, free terms, and the error cases); nothing of the project itself is mocked (no vi.mock of project modules); there are no trivial assertions (toBeDefined, toBeTruthy on the whole result, a snapshot of everything, or an expected value computed by calling the parser); and the parser is not changed to make the tests pass. FAIL otherwise.
