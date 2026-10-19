---
name: typescript
description: "Apply when reading or editing TypeScript. Model with the type system: sum types over flag combinations, branded primitives, parsing at boundaries, no lies to the compiler, exhaustive handling."
paths: ["**/*.{ts,tsx}"]
---
# TypeScript

- Prefer a discriminated union to optional fields that are valid only together.
- Do not lie to the compiler: no `as` casts to silence an error, no `any`, no non-null assertion on a value you have not checked. Narrow instead.
- Parse external data (network, storage, IPC) into a typed value once, at the boundary.
- A branded value gets its brand from a type guard or parser that checks it (`value is UserId`), never from `as`.
- Exhaustive `switch` over a union ends with a `never` check.
- Derive types from their authoritative source (a schema, a const object) instead of restating them.
- Names say what a value is, not its type: `users`, not `userArray`.
- Early returns over nested conditions. Do not extract an early return into a one-call helper.
- Throw `Error` subclasses, never strings. Handle an error where you can act on it; elsewhere let it propagate.
- A change made for performance names the measurement behind it.
