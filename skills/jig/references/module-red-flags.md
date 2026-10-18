# Module red flags

Screen every candidate shape before you pick. A red flag is a reason to revise or reject the shape. Terms follow `references/deep-modules.md`.

The reader to design for: an agent that sees only the files it opened, copies the nearest example and takes the shortest path that compiles. A shape passes when a change that looks right from one file is right for the whole repository.

## Shallow module

Looks like: callers coordinate several entry points to finish one operation; public options expose internal stages or implementation choices; learning the interface does not spare the caller from learning the implementation.
Hurts: every caller repeats the coordination, and an agent copies the nearest call site with its mistakes.
Fix: pull the coordination behind one entry point. Judge depth by the behavior hidden per unit of interface, not by the size of the body.

## Information leakage

Looks like: one internal decision (a representation, a policy, a wire format) appears in more than one module; transport or storage types re-exported on the interface.
Hurts: changing the decision needs coordinated edits, and an agent that edits one site cannot see the others.
Fix: give the decision one owner. Parse external data into domain types behind the interface; keep schemas, framework objects and protocol details private.

## Temporal decomposition

Looks like: modules cut by execution order (load, validate, transform, save), each repeating one representation and its invariants.
Hurts: one rule lives in several stages; an agent fixes it in the stage it opened.
Fix: group by the knowledge owned. Steps that run at different times belong together when they protect the same decision.

## Pass-through method

Looks like: a method that forwards the same arguments to another method of the same shape.
Hurts: a layer to read with nothing to learn; it fails the deletion test.
Fix: delete it, or move the responsibility to the module that can finish the operation. Keep a forwarding seam only when it adds policy, adaptation or a distinct abstraction.

## Split ownership

Looks like: more than one module writes the same state or keeps its own copy of it.
Hurts: an agent that edits one writer cannot see the others, so their rules drift apart.
Fix: one owner per piece of state. Others read it or ask the owner to change it (atom `shared-state`).

## Two ways to do one task

Looks like: the design offers more than one path to the same result.
Hurts: an agent copies whichever path it finds first, so every path keeps gaining callers.
Fix: keep one. Move the callers and delete the others in the same change (atom `one-way`).

## Importable internals

Looks like: code outside a module can import its internals by a deep path.
Hurts: the shortest path that compiles imports them, and they become part of the interface.
Fix: make internals unreachable: a public index plus a build or lint rule (for example a stratum rule) that fails an outside import (atom `system-edges`).

## Hand-synced list

Looks like: two or more places list the same items; adding an item means editing every list.
Hurts: an agent that sees one list updates only that one.
Fix: keep one list and derive the others. A list that cannot be derived gets a check that fails the build when the lists disagree.

## Hypothetical seam

Looks like: a port, interface or injection point with one adapter and no second one in sight.
Hurts: an extra layer on every read path that buys no variation; agents add a second "just in case" seam next to it.
Fix: inline it until a second adapter exists now. A test double counts as an adapter only when the tests use it.

## Testing past the interface

Looks like: tests reach internal state, mock the module's own parts, or need exported helpers that exist only for them.
Hurts: tests break on every refactor, and internals become interface through the test imports.
Fix: test through the interface. Needing to reach past it means the module has the wrong shape: reshape it, then replace the old tests.

## Exposed internal seam

Looks like: a module's internal seam (a strategy, a clock, a storage hook) appears in its public interface only because its own tests use it.
Hurts: callers start depending on it, and the interface grows with every test.
Fix: keep internal seams private; the tests that need them live with the module.
