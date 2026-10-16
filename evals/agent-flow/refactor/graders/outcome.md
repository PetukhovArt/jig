---
type: llm
focus: files
arm: both
---

PASS if both src/features/a/events-connection.ts and src/features/b/telemetry-connection.ts now build on createSharedConnection from src/shared/lib/connection.ts, the hand-written subscriber counters in both are gone, the behavior tests in src/features/a and src/features/b keep their assertions (only imports or names may change), and each feature still sends its subscribe message once per opened socket. FAIL otherwise.
