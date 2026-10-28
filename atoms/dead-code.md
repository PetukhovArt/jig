---
name: dead-code
description: "Apply when deleting code believed unused, or reviewing a diff that leaves an export, file or branch nothing reaches. Code is dead only when every reachability signal agrees."
metadata:
  group: Code
---
# Dead code

- Dead means all of these agree: nothing imports it, nothing references the symbol, and its name does not appear as a string anywhere (templates, configs, JSON, tests, i18n keys, DI tokens).
- Any one keeps the code; name the one that fired: the signals disagree; it is part of a package's public surface; it is reachable without an import (build entry, string key, DI token, reflection, glob-loaded module); a PRD, ADR or roadmap names it as intended behavior.
- A mention in a README or a navigation doc is not a reason to keep it: delete the code and the dangling doc line together.
- Delete the code, the files left empty and the imports that pointed at it in one change.
- A branch the types make unreachable is dead too.
- A dependency is code too: a dependency the project declares (in its dependency manifest, whatever the ecosystem calls it) or a plugin or module it registers is dead when no source file imports it or calls what it provides. It still ships in the build and tells the reader the feature lives there. Remove the entry, the registration and its lock file lines together.
