# MR: maintenance status and settings audit

Branch `feature` into `main`.

## What

- Cameras get a third status, `maintenance`, for planned works.
- `alertLevel` maps a camera status to the alert shown on the wall: `offline` is critical, `maintenance` is a warning, `online` raises nothing.
- Saving camera settings now also records an audit entry (`POST /audit`). The save reports success only after both requests succeed; any failure is returned as `{ ok: false, error }`.

## How to check

`npm run ci`
