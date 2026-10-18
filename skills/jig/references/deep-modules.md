# Deep modules

Design modules with a lot of behavior behind a small interface, placed at a seam where behavior varies, tested through that interface. Callers get leverage, maintainers get locality.

## Glossary

Use these terms exactly in sketches, records, decisions and review threads. Do not substitute "component", "service", "API" or "boundary": one word per idea is the point.

- **Module**: anything with an interface and an implementation, at any scale: a function, a class, a package, a slice across tiers. Not "unit", "component", "service".
- **Interface**: everything a caller must know to use the module correctly: the type signature, plus invariants, ordering constraints, error modes, required configuration, performance characteristics. Not "API" or "signature": both name only the type-level surface.
- **Implementation**: the code inside a module. Distinct from adapter: a small adapter can have a large implementation (a Postgres repository), a large adapter a small one (an in-memory fake). Say "adapter" when the seam is the topic, "implementation" otherwise.
- **Depth**: leverage at the interface: how much behavior a caller or a test exercises per unit of interface it has to learn. **Deep**: much behavior behind a small interface. **Shallow**: the interface is nearly as complex as the implementation.
- **Seam**: a place where behavior can change without editing that place; the location where a module's interface lives. Where the seam goes is a decision separate from what goes behind it. Not "boundary": that word is taken by bounded contexts.
- **Adapter**: a concrete thing that satisfies an interface at a seam. Names a role (the slot it fills), not its content.
- **Leverage**: what callers get from depth: more capability per unit of interface learned. One implementation pays back across every call site and every test.
- **Locality**: what maintainers get from depth: change, bugs, knowledge and verification sit in one place, not across callers. Fixed once, fixed everywhere.

## Relationships

- A module has exactly one interface: the surface it shows callers and tests.
- Depth is a property of a module, measured against its interface.
- A seam is where a module's interface lives.
- An adapter sits at a seam and satisfies the interface.
- Depth produces leverage for callers and locality for maintainers.

## Deep and shallow

- Deep: few entry points, simple parameters, complex logic hidden.
- Shallow: many entry points, parameters that expose internal stages, a body that mostly passes calls on. Avoid.
- A deep module is not a deep call chain. A chain scatters understanding across layers; a deep module concentrates capability behind one interface.
- On every interface ask: can it have fewer entry points? simpler parameters? can more hide inside?

## Principles

- **Depth belongs to the interface, not the implementation.** A deep module can be built from small, swappable parts inside; they are not part of its interface. It can have internal seams (private, used by its own tests) besides the external seam at its interface.
- **Deletion test.** Delete the module in your head. Complexity that vanishes was a pass-through. Complexity that reappears across callers was earning its keep.
- **The interface is the test surface.** Callers and tests cross the same seam. Needing to test past the interface means the module has the wrong shape.
- **One adapter is a hypothetical seam; two adapters make a real one.** Add a seam only where something varies across it now. A real seam needs a shape: atom `patterns`.
- **Caller's usage first.** Write the call sites before the types; when they disagree, fix the types.

## Red flags

Screen every shape against `references/interface-red-flags.md`. Assume the next contributor is an agent that sees only the files it opened, copies the nearest example and takes the shortest path that compiles. Prefer the shape where a change that looks right from one file is right for the whole repository.

## Rejected framings

- **Depth as implementation lines over interface lines**: rewards padding the implementation. Depth here is leverage.
- **Interface as the TypeScript `interface` keyword or a class's public methods**: too narrow. The interface is every fact a caller must know.
- **"Boundary"**: overloaded with bounded contexts. Say seam or interface.

## Deepening

Deepen a cluster of shallow modules by first sorting its dependencies. The category decides how the deepened module is tested across its seam.

1. **In-process**: pure computation, in-memory state, no I/O. Always deepenable: merge the modules and test through the new interface. No adapter.
2. **Local stand-in**: the dependency has a local test double that runs for real (PGLite for Postgres, an in-memory filesystem). Deepenable when the stand-in exists; tests run against it. The seam stays internal, with no port on the external interface.
3. **Remote but owned**: your own services across a network. Define a port at the seam; the deep module owns the logic, the transport is an injected adapter. Tests use an in-memory adapter, production an HTTP, gRPC or queue adapter.
4. **True external**: third-party services you do not control. The module takes the dependency as an injected port; tests pass a mock adapter.

Seam rules:
- A port needs at least two adapters it justifies now (usually production and test). A port with one adapter is indirection.
- Internal seams stay internal. Do not expose them on the interface because tests use them.

Tests: replace, do not layer.
- Once tests exist at the deepened interface, the old tests on the shallow modules are waste: delete them.
- Assert observable outcomes through the interface, not internal state (atom `tests`).
- A test that changes when only the implementation changes is testing past the interface.

## Design it twice

The first shape is rarely the best. For a new or reshaped interface:

1. Frame the problem: the constraints any interface must meet, the dependencies and their category, a rough code sketch that makes the constraints concrete (an illustration, not a proposal).
2. Produce at least two radically different interfaces, in parallel when you can (`references/coliseum.md`). Give each attempt its own direction, for example: minimal interface (one to three entry points, most leverage per entry point); maximal flexibility (many use cases, extension); the common caller (the default case trivial); ports and adapters for dependencies across the seam.
3. Each attempt returns: the interface (types, entry points, parameters, invariants, ordering, error modes); a caller's usage example; what the implementation hides; the dependency strategy and its adapters; where leverage is high and where it is thin.
4. Compare by depth, locality and seam placement, scoring each criterion separately, and screen each against the red flags. Then pick, with a reason.
5. Converged: the shapes agree; take it, no hybrid. Wildly diverged: step 1 was under-specified; reframe and rerun, do not average. Otherwise pick a base (the one a future maintainer extends most easily without breaking its invariants) and graft one or two ideas from the others by hand, naming each graft and its source.
