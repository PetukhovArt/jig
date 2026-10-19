---
name: patterns
description: "Apply when designing a module interface with two or more variants, or when untangling complex code: a switch on type, an instanceof chain, duplicated conditional creation, an import cycle. Map the problem to the pattern that solves it."
metadata:
  group: Design
---
# Patterns

- Switch or if-chain on a type that recurs: Strategy or polymorphism; one registry both sites share.
- Duplicated conditional creation: a Factory (a function, not a class hierarchy, unless variants carry behavior).
- Several representations behind one interface: Adapter at the boundary.
- An object whose behavior depends on its state: State machine (a union plus a transition function).
- Optional cross-cutting behavior around a call: Decorator or a wrapping function.
- Many listeners to one source: Observer with a typed contract, owned by the source.
- An import cycle: invert the dependency (the lower module defines the interface, the higher one implements it) or extract the shared part.
- Undoable or queued operations: Command objects.
- A pattern is justified by a second variant that exists now. One variant is just code.
