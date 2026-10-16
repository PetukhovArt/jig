---
type: llm
focus: files
arm: both
---

PASS if the change adds a status filter with the options online, offline and all to the camera list; the selected status lives in the camera list store (src/features/camera-list/model/camera-list-store.ts); it is persisted through the existing persisted() helper of src/shared/lib/storage.ts, with no direct localStorage or sessionStorage access added anywhere; and the visible list honors the selected status. FAIL otherwise.
