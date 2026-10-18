---
name: why-this-number
description: "Apply before you trust, report or act on a measured number: a speedup, a regression, a latency, a throughput, an eval score. Find what limits it and rule out that it measured something other than the work you think."
---
# Why this number

- Ask "why is it not twice as good?" and name the limiter from a profile or a trace, not from intuition.
- Rule out confounders: errors that made work skip, caching, dead code paths, an untuned baseline, a different machine or build mode, noise.
- Keep the run count and the spread with the number. One run is an anecdote.
- Measure the same scenario before and after, on the same machine, in the same mode (production build when production matters).
- A number without a baseline and a delta is not a result.
- Performance work follows the order: don't do it, don't repeat it, do less, do it later, do it while the user is not looking, do it concurrently, do it cheaper.
