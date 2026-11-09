---
"jig": patch
---

With a gitignored lock file, a dependency pool reuse warns that a dist-tag or range moved on the registry since the version was installed is not in it, and `jig worktree deps <dir> --refresh` runs the resolving install instead and saves its lock file as the newest version (#32).
