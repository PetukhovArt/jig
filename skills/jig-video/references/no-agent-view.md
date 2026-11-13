# Without agent-view

When agent-view is not installed and cannot be: `fv.mjs` drives the app over native CDP by itself, with the port from `agent-view.config.json` or `CDP_PORT`. Probes in steps 3–4 go through `node "${CLAUDE_PLUGIN_ROOT}/skills/jig-video/scripts/fv.mjs" cdp <verb> …` (`click`, `fill`, `wait`, `eval`, `drag`, `screenshot [file]`; `/json/list` on the port lists the windows). Selectors are limited to `--testid`, `--selector`, `-f`, `--pos`, and `drag` to `--from-pos/--to-pos`; refs from `dom`, `--scene` and HTML5 drag fail with an error naming that limit.
