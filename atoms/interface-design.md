---
name: interface-design
description: "Apply before you write code that crosses a function boundary: a new or changed signature, exported type or module surface. Design a deep module: a small interface over much hidden behavior, a seam only where behavior varies, the caller's usage first, two shapes compared by depth."
---
# Interface design

Vocabulary (module, interface, depth, seam, adapter, leverage, locality) and red flags: `skills/jig/references/deep-modules.md`. Use its terms exactly.

- Write the caller's usage first: the import, the call, what comes back. The interface follows from it.
- The interface is everything a caller must know: the types, plus invariants, ordering, error modes, configuration. Count all of it.
- A deep module hides much behavior behind a small interface. Ask: fewer entry points? simpler parameters? more hidden inside?
- Deletion test: delete the module in your head. Complexity that vanishes was a pass-through; complexity that reappears in every caller was earning its keep.
- A seam goes where behavior varies now. One adapter is a hypothetical seam; two adapters make it real (atom `patterns` picks the shape).
- Design it twice: at least two structurally different shapes, not two variants of one. Compare them by depth, locality and seam placement, one criterion at a time (atom `design-alternatives`).
- Test through the interface. A test that has to reach past it says the module has the wrong shape.
- Prefer deepening a module that already exists over adding a new one next to it.
- Parse external data into domain types behind the interface; wire and framework types stay off it (atom `boundaries`).
- A shape that adds layers between a question and its answer loses, whatever its depth (atom `reader-cost`).
