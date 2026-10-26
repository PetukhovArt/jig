---
"jig": patch
---

`jig slot new` writes the slot's `agent-view.config.json` with the main checkout's `url` moved to the slot: a local port that a `ports` entry starts at becomes the slot's port, another local port is left out with a warning instead of pointing at slot 0. A new `slots.slotEnv` (`{ "key": "SLOT", "target": ".env" }`) writes the slot number itself into an env file, so a dev script that derives its ports from it starts the slot's own instance from the unchanged `dev` or `launch`. (#8)
