---
name: effects
description: "Apply when writing or reviewing reactive code (Vue, React, Solid, signals, stores). Derive state instead of syncing it with effects; an effect is for talking to the outside world, not for wiring one piece of state to another."
metadata:
  group: Code
---
# Effects

- A watcher or effect that copies or transforms one state into another is a derived value in disguise: make it computed.
- Effects are for the outside world: network, storage, timers, DOM APIs, subscriptions to external sources.
- Two pieces of state that must stay in sync are one source of truth and one derivation.
- An effect that sets state which triggers another effect is a chain: collapse it into a derivation or one event handler.
- React to the user's event in the event handler, not in an effect watching a flag the handler set.
- Every subscription an effect opens is closed by its cleanup.
- A reactive container that a continuous stream writes (socket, push channel, timer, event bus) is shallow: only the top-level reference is tracked, and each update replaces the whole value. A deep container wraps every nested object on each write and wakes every dependent derivation and watcher: constant CPU load and update cascades.
- Reactivity crossing module boundaries or an `await` is where bugs hide: check what is still reactive on the other side.
