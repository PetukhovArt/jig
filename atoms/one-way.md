---
name: one-way
description: "Apply when introducing a new API, abstraction or way of doing a task while old ones exist. There is one way to do each task: migrate every caller and delete the old way in the same wave; keep a compatibility layer only while an intermediate state ships to a shared branch."
metadata:
  group: Design
---
# One way

- Search for an existing implementation before writing a helper, mapper, hook, type or component. Reuse or extend it.
- Two copies of one intent that must change together are a finding; two look-alikes that change for different reasons are not.
- A copy that holds an invariant (validation, permissions, money, synchronization) is the most dangerous duplicate.
- New API in, old API out: migrate callers and delete the old one in the same change.
- Within one merge request or branch, go straight to the target. No throwaway compatibility layers.
- A compatibility layer is allowed only when the intermediate state is merged into a shared branch for other people. It is removed together with the migration of its last caller.
- A reviewer's local patch for a problem an existing abstraction already solves is the wrong fix: migrate to the abstraction instead.
