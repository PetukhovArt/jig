---
"jig": patch
---

Review angle 16: test resources (fixtures, data files) are subjects and fixture data no test reads is a redundant candidate; new junk items (expected values copied from the implementation, a name its setup contradicts, a helper imported past the module's public interface); a contract keeps a test only with expected values from an independent source; `review-plan` prints `tests parts of the run:` so a test-reviewer searches the other partitions for duplicates; the runner passes diff parts without narrowing how a finder reads them (#39)
