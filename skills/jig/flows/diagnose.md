---
name: diagnose
description: "find the cause of a symptom without fixing it, from a live process or a captured artifact; the fix is bug-fix."
---
# diagnose

**You own the diagnosis, not the fix. Instrument or query, don't theorize from source.**

Atoms: root-causes, why-this-number, evidence, context-window.

Discipline: `references/diagnosis.md`.

1. Frame the symptom: what goes wrong, where it is seen, since when. Diagnosed means: a mechanism at `file:line`, confirmed by an observation that would have come out differently if it were false.
2. Pick the branch: a live process you can run, or a captured artifact handed to you (cpuprofile, heapsnapshot, trace, log dump).
3. Live process: build the feedback loop (diagnosis phases 1 and 2), then capture the signal on the running app: a heap snapshot for a leak, a CPU profile for a spin, a CDP trace for a glitch (agent-view heap, profile and trace when agent-view is configured, SKILL.md). Otherwise `skip: artifact given`.
4. Captured artifact: identify the format and read it, do not re-run it. A large artifact becomes queryable first: the tool's own query command (agent-view heap), otherwise sqlite or a script, one row per sample, frame or node. A paired before-and-after capture: diff the two. Otherwise `skip: live process`.
5. Reduce in a subagent and keep only the finding: the function on the hot path, the retainer chain from the leaked object to a root, the loop firing without input.
6. Hypotheses and proof (diagnosis phases 3 and 4): ranked, each with a prediction; confirm the mechanism with a cheap probe on the running process. An artifact with no second capture: the finding is the strongest hypothesis it supports, labeled so.
7. Map the finding to source: file, symbol, the line that allocates or schedules. A frame with no source mapping is not a diagnosis yet: resolve its symbols, or say the artifact does not carry them.
8. Remove every probe you added (search the debug tag).

Reply: the signal or artifact and its format, the reduced finding, how the mechanism was proven, the source location, the artifact paths. No fix: hand the cause to `flows/bug-fix.md` or `flows/perf.md`.
