---
name: tests
description: "Apply when you write, change, keep or review a test. Assert what the code's users can observe, so the test fails when that behavior breaks and keeps passing when only the internals change. No test is the default."
metadata:
  group: Code
---
# Tests

- Default: no new test. Write one only if you can finish the sentence "this test fails when a developer <edit>, which breaks <behavior>" with a realistic edit.
- Worth a test: a regression of a real bug, a contract between modules, an edge case with a high error cost, an integration with infrastructure, a state machine or invariant.
- Two imagined edits judge a test: break the behavior, it must fail; restructure the internals, it must still pass.
- Search the existing tests of the unit first. Extend a table-driven case instead of adding a near duplicate.
- Junk: no assertion or a trivial one (exists, truthy, does not throw); the expected value computed by the code under test; mocking the unit under test; a mock that implements the asserted behavior; grepping source text; a negative case that passes for an unrelated reason.
- Mock only real boundaries (platform, network, external services), never your own modules.
- A regression test must fail on the code before the fix. Run it before fixing.
- A test that needs an export, flag or hook no production caller needs is testing at the wrong seam: test at the real boundary.
- Trivial code (a getter, a re-export, a wrapper) gets no test.
