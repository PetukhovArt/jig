# Diagnosis

A discipline for finding why a system misbehaves: a wrong result, a crash, a leak, a slowdown. Skip a phase only with a written reason.

Redact every secret before you show a command, an output or an artifact: write `<REDACTED>` in its place. Build loops on environment variables so credentials stay out of what you show. Quote only the lines of a captured artifact that carry the signal.

## 1. Build a feedback loop

This is the phase that decides the outcome. With a **tight** loop that goes **red** on this bug, bisection, hypotheses and instrumentation all become mechanical. Without one, reading code will not find it. Work down this list before concluding no loop is possible:

1. A failing test at whatever seam reaches the bug: unit, integration, end to end.
2. An HTTP script against a running dev server.
3. A CLI call with a fixture input, its output diffed against a known-good snapshot.
4. A runtime check: drive the UI and assert on the DOM, console or network (agent-view when it is configured, SKILL.md, on its runtime).
5. A replay of a captured trace: a saved request, payload or event log run through the code path in isolation.
6. A throwaway harness: the smallest subset of the system (one service, stubbed neighbors) that runs the bug path in one call.
7. A property or fuzz loop: for "sometimes wrong", run a thousand random inputs and catch the failure.
8. A bisection harness: the bug appeared between two known states (commit, dataset, version); automate "boot at state X, check" and run `git bisect run`.
9. A differential loop: the same input through the old and the new version (or two configs), outputs diffed.
10. A human in the loop, last: a script that tells the human each action, waits, and captures what they saw, so the loop is still structured.

Tighten the loop once you have one: faster (cache setup, narrow scope), sharper (assert the exact symptom, not "did not crash"), deterministic (pin time, seed randomness, isolate files and network).

A non-deterministic bug needs a higher reproduction rate, not a clean repro: loop the trigger, parallelize, add stress, narrow timing windows. Raise the rate until it is debuggable.

No loop possible: stop and say so. List what you tried. Ask the human for access to an environment that reproduces it, a redacted captured artifact (HAR, log dump, core dump, recording with timestamps), or permission for temporary instrumentation. No loop, no hypotheses.

Done when you can name one command you have already run (invocation and redacted output shown) that is:
- red-capable: it drives the real bug path and asserts the user's exact symptom;
- deterministic: the same verdict every run, or a pinned high rate for a flaky bug;
- fast: seconds, not minutes;
- runnable by you unattended.

## 2. Reproduce and minimize

Run the loop and watch it go red. Confirm it is the failure the user described, not a nearby one, and that it repeats. Capture the exact symptom (message, value, timing).

Cut inputs, callers, config, data and steps one at a time, rerunning after each cut. Done when every remaining element is load-bearing: removing any one turns the loop green.

## 3. Hypothesize

Write 3 to 5 ranked hypotheses before testing any. Each states a prediction: "if X is the cause, changing Y makes the bug disappear, changing Z makes it worse". A hypothesis without a prediction is discarded or sharpened. Show the ranked list to the human; continue with your ranking without waiting.

## 4. Instrument

Each probe tests one prediction; change one variable at a time. Prefer a debugger or REPL, then targeted logs at the boundaries that separate hypotheses; never log everything and grep. Tag every debug log with one unique prefix (`[DEBUG-a4f2]`) so cleanup is one search. A slowdown is measured, not logged: a baseline from a profiler or timing harness, then bisect.

Live process: a heap snapshot, a CPU profile or a CDP trace of the running app (agent-view heap, profile or trace when it is configured). Captured artifact (cpuprofile, heapsnapshot, trace, log dump): read it, do not re-run it. A large artifact is turned into a form you can query before reading it: the tool's own query command first (agent-view heap), otherwise load it into sqlite or walk it with a script, one row per sample, frame or node. Parse it in a subagent and keep only the reduced finding.

Done when one hypothesis is confirmed by an observation that would have come out differently if it were false, and mapped to `file:line`.

## 5. Fix

A regression test only at a seam where it reproduces the real bug pattern as it happens at the call site; then write it before the fix and watch it fail. No such seam: that is a finding about the architecture; report it. Apply the fix, rerun the minimized loop, then the original unminimized scenario.

## 6. Clean up

- The original loop no longer goes red.
- The regression test, if written, passes.
- Every tagged debug log is gone (search the prefix).
- Throwaway harnesses are deleted or moved outside the source tree.
- The confirmed hypothesis is stated in the commit or merge request.
