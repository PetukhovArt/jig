# Gates: bug angles 1–5, 12, 14

A judge of a cluster with bug candidates reads this file and [severity](severity.md). The main session reads it on the inline path ([step 04](../steps/04-inline.md)).

## Verdict

- `CONFIRMED`: the bug is proven in three parts, each with a quote:
  - **initiator**: a user action, a system event or a backend response in a production build. A trigger that exists only in development (hot reload, a dev flag, a mock) is not an initiator;
  - **path**: `file:line` for every step from the initiator to the defective line, with the producer of the input: who writes this state, who passes this argument. An input the code does not control is named as a place, not a category ([forms below](#bug-calibration));
  - **effect**: observable by the user and wrong by the requirement: the spec, a recorded decision, the task's scenario. Differing from neighbouring code does not prove wrongness: neighbours may have other scenarios.
- `REFUTED`: factually wrong, covered elsewhere, or not proven: no initiator, the path breaks, the effect is not named or is correct by the requirement. The reason is named and the proving line quoted. Both go into `summary`: the "Refuted" section of the output prints from it.

A bug has no third verdict: "the mechanism is real, the trigger is not proven" is `REFUTED` with the reason "not proven". A `CONFIRMED` bug then passes the [rare gate](#rare-gate).

**The self-check before every `CONFIRMED`:** "Who is the initiator in production, where is the path to the effect, and why is the effect wrong by the requirement? No quote for any one of them: not CONFIRMED." Models put CONFIRMED on hypothetical state readily; the question at the moment of the verdict is the only thing that stops it.

Two Nits reached threads on an unproven input: "entering a value loses its seconds" (the mechanism is real, but the effect is intended: that field takes the whole value in exactly that format) and "no limit on entered values" (no path from that input field was named, and the author checked another input). Both are `REFUTED: not proven`.

## Bug calibration

**The class of a defect argues neither way:** a race between async flows, null on a rare path, falsy zero, an off-by-one at a boundary, a retry storm, an unanchored regex, a stale closure, an unhandled reject. Path built: `CONFIRMED`; not built: `REFUTED`.

**The path to the mechanism** has two legitimate forms, no others:

1. a caller, input or state inside the code: quote the call site or the field that feeds it;
2. a trigger the code does not control: a backend response, concurrency, the clock, the environment, the config, an exported symbol with callers outside the repository. **Name the place, not the category**; the word "concurrency" or "config" is not a path:
   - backend response → the response field plus the line that reads it;
   - concurrency → two concrete calls that can interleave, both quoted;
   - config or environment → the key plus the file where it is set;
   - clock → the line that reads the time plus the window in which the value is wrong;
   - external caller → the exported symbol plus a real call outside the repository.

   Plus the guard that would have excluded the trigger.

**A race, a late async response, a lifecycle order** (a response after logout, a load across a user switch, dispose before resolve): the place is the **trigger path** from the user action to the race, `file:line` per step: which action, who calls teardown, dispose or reset, what is in flight at that moment. The path built in full: judge by the forms above. The path breaks: `REFUTED` with "not proven", into `suppressed_speculative`.

No form: `REFUTED`, "not proven". A category instead of a place: also "not proven".

This kills a finding that exists only because the shape of the code allows it, and keeps every timing, environment and config defect whose path is named.

`REFUTED` with "not proven" is counted in `suppressed_speculative`, otherwise the bar cannot be tuned. Other `REFUTED` are not counted: they are about a wrong fact, not unproven reachability.

**Both errors are live.** A missed real defect costs exactly as much as an invented one. `REFUTED: not proven` is legitimate only after the initiator and the path were **searched for**, not because they were absent from the file already open. Searched and not completed: the `summary` says at which step the path broke; a silent `REFUTED` is indistinguishable from a miss.

## Rare gate

A proven bug is not reported as a task when both hold:

- the input is off the happy path, not the task's main scenario: an extreme value, a hand-edited file, a rare sequence of actions;
- the fix adds code: a guard, a branch, new state, rather than deleting code or narrowing a type.

Recoverability is not a condition: "reload" or "fix it by hand" fits almost any front-end bug, and a wrong value in front of an operator mid-shift is not safe because it can be fixed later.

Exceptions where rarity does not matter: data loss or corruption, security (angle 14), a broken system invariant.

Such a finding is a known risk, not a task: it goes into neither state nor threads, is counted in `tally.suppressed_rare`, and gets one summary line `known risks: <file> · <defect>`. The author fixes everything a thread shows, so a thread on an unneeded fix turns into extra code.
