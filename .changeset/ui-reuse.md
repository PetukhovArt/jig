---
"jig": minor
---

`jig ui reuse [--base <ref>] [--json]` finds raw elements (`<button`, `<input`, `h('button'`, ...) that `ui.components.map` replaces with a shared or library component, on changed lines only (the branch against its merge base, uncommitted and untracked files included), in component files outside `ui.components.dirs`; it exits 1 and names the component to use.
