---
name: boundaries
description: "Apply when wiring validation, error handling, adapters or imports across modules. Guard at system boundaries (network, storage, IPC, CLI, config), trust internal types, keep business logic pure, and cross module boundaries only through their public interface."
---
# Boundaries

- Parse untrusted input into a trusted type once, at the boundary. Downstream code trusts the type and does not re-validate.
- Ask "is this data crossing a system boundary right now?" If not, validation is redundant.
- Keep framework and boundary types out of the domain's public surface.
- Business logic is a pure function of its inputs; effects live at the edges.
- Another module's internals are reached only through its public index or its registered API, never by a deep path.
- A lower layer never reaches into a higher one. When it seems to need to, the knowledge belongs lower.
- Moving code into another layer to dodge a boundary is still a boundary violation.
