---
name: comments
description: "Apply when you add, keep or review a code comment. The code is the source of truth: a new comment is allowed only if it is a license header, a TODO with a ticket id, JSDoc that says more than the signature of a public API, a constraint forced by external code with a link, or a tool directive."
---
# Comments

- Allowed: a license header; `TODO(<ticket>)` with a real ticket id; JSDoc of a public API that states what the signature cannot (units, ranges, side effects, errors); behavior forced by code you cannot change (library, platform, protocol, upstream bug) with the link to the issue or RFC; a tool directive that only looks like a comment (`/// <reference ...>`, `// @stratum-purity N`, bundler magic comments).
- Everything else goes: restating the code, history (tickets, removed code, diffs), commented-out code, dividers, JSDoc that repeats the signature.
- An explanation of your own non-obvious code is a refactoring signal: rename, extract a named function, express it as a type, or reorder.
- A constraint in words ("do not delete", "keep in sync") becomes a type, a runtime check, a test or a lint rule.
- An allowed comment holds only if the code next to it confirms what it says.
- Suppression directives (lint or type checker) are a human's decision. Fix the finding instead.
- Agents copy what they see: one harmless comment spreads into every file that imitates it.
