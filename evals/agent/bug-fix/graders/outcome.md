---
type: llm
focus: files
arm: both
---

PASS if the change fixes the off-by-one inside src/shared/lib/paginate.ts itself, so the last page returns every remaining item (12 items with page size 5 give 2 items on page 3, 10 items give 5 on page 2), instead of compensating in the component or elsewhere, AND it adds or changes a test that covers the last page and would fail on the original code. FAIL otherwise.
