---
name: perf
description: "measure, explain the limiter, fix, measure again."
---
# perf

**You own the measurement story. Plan, review, verify the numbers.**

Atoms: why-this-number, root-causes, prove-shippable.

1. Capture a baseline on the user's scenario: a trace, a profile or a benchmark, several runs, the same build mode as production.
2. Explain the number: name what limits it before changing anything.
3. Write hypotheses in the order: don't do it, don't repeat it, do less, do it later, do it while the user is not looking, do it concurrently, do it cheaper.
4. Change one thing at a time; measure after each, same scenario, same machine.
5. Compare before and after artifacts; keep run count and spread with the numbers.
6. Runtime-visible change: the bug-bash in `flows/mr.md` runs the perceived-performance attacks at x1, x10 and x100 data. Otherwise `skip: not runtime-visible`.
7. `flows/mr.md`, citing the numbers in the description.

Reply: the baseline number, the post-fix number, the delta with run count and spread, the limiter you found, the artifact paths.
