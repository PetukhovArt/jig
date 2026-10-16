---
type: llm
focus:
  source: file
  path: review.md
arm: both
---

PASS if review.md reports both bugs with a file:line reference: (1) in src/features/camera-settings/save-settings.ts the api.put call is not awaited, so a failed or slow save is reported as success and its rejection goes unhandled; (2) in src/features/camera-alerts/alert-level.ts the switch in alertLevel does not handle 'maintenance', so maintenance cameras get 'none' instead of the 'warning' the MR description promises. The if/else that returns true/false in isCritical may appear only as a style remark, not as a bug. FAIL if either bug is missing or the style remark is presented as a bug.
