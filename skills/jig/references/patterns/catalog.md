# Design patterns: catalog

Find the problem you have, not the pattern you like. A pattern earns its place when a second variant, a second caller or a second representation exists now; for one variant, plain code wins.

Code for a pattern: the adapter for the language in this folder (TypeScript: `<root>/skills/jig/references/patterns/typescript.md`). A language without an adapter: use this catalog alone with the idioms of that language.

## Creational

| Pattern | Problem it solves | Not worth it when |
|---|---|---|
| Factory | Several places build the same object with the same branching. | The object is a literal built in one place. |
| Factory Method | The concrete type depends on config, platform or input, and callers must not know it. | There is one type. |
| Abstract Factory | Whole families of objects must match (platform A parts never mix with platform B parts). | Objects vary one at a time, not as a set. |
| Builder | An object has many optional or conditional parts, and the constructor call becomes unreadable. | An options object with defaults reads fine. |
| Prototype | Creating from scratch is costly; a prepared instance can be cloned. | Creation is cheap. |
| Object Pool | Objects are created and destroyed so often that allocation or setup cost shows in profiles. | No measured cost: a pool adds lifecycle bugs (leaks, stale state). |
| Singleton | One shared instance for the process. Mostly an anti-pattern: hidden global state, hard to test. Prefer passing the instance; when needed, a module-level export is the singleton. | Almost always. |

## Structural

| Pattern | Problem it solves | Not worth it when |
|---|---|---|
| Adapter | An external or legacy interface does not match the internal contract; convert at the boundary, change neither side. | You own both sides: change one of them. |
| Wrapper | Delegate calls to a function or object and add behavior around them (a narrow Adapter). | The behavior belongs inside the wrapped code. |
| Decorator | Layer optional behavior (cache, retry, log, auth) by composition, without subclassing. | Only one combination is ever used. |
| Proxy | A gate in front of a resource with the same interface: lazy init, cache, access check, call interception. | Callers can call the gate explicitly and that is clearer. |
| Facade | One simple entry point over a subsystem with many parts. | The facade only forwards calls one to one: a shallow module. |
| Bridge | Two dimensions vary independently (shape × renderer, storage × format); compose them instead of multiplying subclasses. | Only one dimension varies. |
| Composite | Treat one item and a tree of items through the same interface (DOM, file system, menu). | The structure is flat. |
| Flyweight | Many similar objects share most of their data; share the immutable part to save memory. | Object count is small or data is not shared. |
| Value Object (Boxing) | A primitive carries domain meaning and rules (`Email`, `Money`); wrap it so the rules travel with the value, compare by value. | The value has no rules of its own. |
| Context | Pass state and dependencies across layers that share no environment, without coupling them to each other. | Explicit parameters are few and stable. |

## Behavioral

| Pattern | Problem it solves | Not worth it when |
|---|---|---|
| Strategy | A recurring switch or if-chain picks one of several interchangeable algorithms. Keep the variants in one registry. | Two branches in one place. |
| State | Behavior depends on a phase (idle, loading, failed), and the flags that encode it combine into invalid states. Model a finite state machine: states plus transitions. | One boolean that never combines with others. |
| Command | Actions must be queued, logged, retried, undone or sent elsewhere: make each one a value. | Actions run once, right away. |
| Memento | Save and restore snapshots of state without exposing internals (undo, drafts). | State is already immutable: keep the old value. |
| Chain of Responsibility | A request passes handlers in order until one takes it; every handler can read, one acts. | One handler always acts. |
| Middleware | Like the chain, but every handler may change the request and pass it on. Watch order dependence and races. | Handlers do not share the request. |
| Observer | Many listeners react to one source; the source owns a typed contract and does not know the listeners. | One listener: call it directly. |
| Mediator | N components that talk to each other make N² links; one coordinator owns the rules between them. | Two components. |
| Iterator | Walk a collection or stream element by element without exposing its storage; lazy and async sources included. | A plain array loop works. |
| Template Method | The algorithm is fixed, some steps vary. Pass the varying steps as functions rather than subclassing. | All steps vary: that is a Strategy. |
| Visitor | Add operations over a closed set of node types without editing the nodes (AST, document tree). | The set of types changes more often than the set of operations. |
| Interpreter | Evaluate a small language or expression tree (filters, rules, formulas). | A parser library or a data format does it. |
| Revealing Constructor | Give the constructor a function that receives private capabilities once (`new Promise((resolve, reject) => ...)`), so the outside never gets them. | The capabilities can be public. |
| Actor | State that concurrent callers touch: one owner processes messages from a queue, one at a time. | No concurrency on that state. |
| Reactor / Proactor | Dispatch many I/O events through one loop to registered handlers (the runtime event loop is one). | You are not writing a runtime or a server core. |
| Service Locator | One registry to register and fetch services. It hides dependencies: prefer explicit injection; the module system already is a locator. | Almost always. |
| Null Object | A neutral implementation of the interface instead of null checks at every call site. | Absence must be visible and handled. |

## Data access

| Pattern | Problem it solves | Not worth it when |
|---|---|---|
| Transaction Script | One function per business operation that coordinates checks, data and effects. Fine for simple domains. | Rules repeat across scripts: move them to the domain model. |
| Table Module | All logic for one table or collection in one module; rows are plain data. | Rows have rich behavior of their own. |
| Active Record | A domain object that loads and saves itself. | Domain rules must be tested without storage. |
| DAO | An interface to persist and fetch records, so the domain does not know the storage. | One storage and no tests without it. |
| Repository | Domain-shaped access: returns entities, takes domain queries, hides the DAO and the mapping. | The domain is CRUD over DTOs. |
| DTO | Plain data that crosses a boundary (network, process, layer). No behavior. | Data never leaves the module. |
| Unit of Work | Track changes and write them in one transaction. | Every operation writes once. |
| Saga | A long process across services: a chain of local transactions, each with a compensating action, instead of a distributed lock. | One database transaction covers it. |

## Assigning responsibility (GRASP, SOLID)

When the question is "who owns this", not "which pattern":

- Information Expert: give the job to the module that has the data.
- Creator: the module that holds, aggregates or mostly uses an object creates it.
- Controller: one entry point per use case takes the outside input (UI, API, event) and delegates.
- Low coupling, high cohesion: few calls across a module edge; everything inside serves one purpose.
- Polymorphism: dispatch on a shared interface instead of branching on the type.
- Pure Fabrication: a technical abstraction (emitter, stream, repository) is fine when no domain concept fits.
- Indirection, Protected Variations: a stable interface in front of what will change, and only there.
- Single responsibility: one reason to change, one actor who asks for it.
- Open-closed: add a variant without editing the code that uses the variants.
- Liskov substitution: every implementation keeps the contract callers rely on.
- Interface segregation: small interfaces per client over one wide one.
- Dependency inversion: the lower module defines the interface it needs; the higher module implements it.
