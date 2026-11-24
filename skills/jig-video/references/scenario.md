# scenario.json

```json
{
  "title": "Scene and Trends in separate windows",
  "subtitle": "MR !41 · settings-dialog",
  "setup": [
    "Reset the demo data: git checkout <start commit> -- scenes/demo.yaml",
    "Place the Main window on the left of the screen: fv.mjs window place --left Main"
  ],
  "cases": [
    {
      "id": "scene-window",
      "setup": ["Click the tab Demo in the window Main"],
      "steps": [
        {
          "id": "open-scene",
          "say": "A scene tab now opens in its own window from the tab menu.",
          "do": [
            "Right-click the tab Demo in the window Main",
            "Click the menu item Open in separate window",
            "Wait until the window Demo shows the button with the title Fit to window",
            "Place the window Demo on the right: fv.mjs window place --right Demo --wait 5"
          ]
        }
      ]
    }
  ]
}
```

- `cases` run in order, each recorded as its own clip. Step ids are unique across all cases (`audio/<id>.<ext>` is per step).
- **Start state.** Before every case you bring the app to the scenario's `setup`, then the case's own `setup` (optional). `setup` brings the app to the common start state from any state the last run left: close its windows, reset the demo data (`git checkout` of the changed files), hide the sidebars, set zoom, lay the windows out. A case's `setup` adds what this use case needs on top, e.g. the tab it starts from. So a case never depends on what the previous one left, any case can be recorded alone, and two runs in a row pass without cleanup. `teardown` (optional) is done after each case's capture stops, for data that is not disposable.
- `setup`, `teardown` and `do` are lists of actions in words, one per item: what the user does, naming the element as the user sees it (its test id, label, title or visible text, and its window when the app has more than one). The model carries them out with its app control tool (`skills/jig/SKILL.md`, App control); the scripts read none of them, only `id`, `say` and `delay` of steps. Never an action the user could not take: no script calls or injected events as the demo's action. An item may name a command to run (`git checkout …`, `fv.mjs window place …`): it is a command every teammate's OS has, never a shell script. A step whose Proof is that nothing happens (a read-only window) needs a visible attempt, or the frame shows nothing.
- **The cursor is mandatory**: every click in the video shows a dot. The capture draws no real cursor by default, and a tool that sends input to the page moves none. Before the first action of a window, give the page the dot with `scripts/cursor-dot.js` through whatever script-running capability the tool has (a page overlay is not app state), then before each click or drag start call `__fvCursor.toElement(element)` or `__fvCursor.to(x, y)`; the dot follows mouse events during a drag. A tool that moves the real mouse (computer use) needs no dot: record with `--cursor` and the capture draws the cursor. No way to do either: tell the user the video will show no cursor. A video without the cursor cannot be fixed after recording: it is a re-recording.
- **Pace**: an app control tool acts at machine speed, so actions flash by. Give a visible action room: one action per item, a pause of 0.8–1.5 s after an action whose result the viewer must notice. The opposite failure is a long still frame: a step lasts until its slowest wait (a backend event, a reconnect), long after the sentence ended. Do such waits in `setup` when the video does not need them, and after `assemble` run `node "${CLAUDE_PLUGIN_ROOT}/skills/jig-video/scripts/speed-gaps.mjs" <dir> [factor=3]`: it speeds up every stretch with no narration and keeps spoken parts at 1x, writing `video-fast.mp4` without re-recording.
- **Timing while recording.** `fv.mjs mark <dir> <stepId>` starts a step: it first waits until the previous step's `delay` + narration + 0.6 s have passed since its mark, then stamps this step and prints its sentence. Do the step's actions right after it, the action the sentence describes first. `fv.mjs stop <dir>` waits out the last step plus a 1 s tail and ends the clip. So a step lasts as long as its actions or its narration, whichever is longer, plus 0.6 s.
- A window title in `window` commands matches whole and case-insensitive, with `*` and `?` wildcards (`"*Demo"`).
- `fv.mjs window place --left "<title>" --right "<title>" --split-x "<px>" --wait "<s>"` (each flag optional): places windows left and right of `--split-x` on the primary work area (default: half of it); fails when a title matches no window within `--wait`. A new window shows up where the OS put it and jumps into place a moment later; the jump is in the video.
- `fv.mjs window pin --title "<title>" --width "<px>" --height "<px>" --secondary`: restores the window and sets its client area to that size, at the top-left of the primary screen's work area or of the other screen. The size is in physical pixels on Windows and Linux and in points on macOS (there add `--inner <innerWidth>x<innerHeight>`, read from the app, to correct for the title bar); CSS pixels equal it only at 100% scaling: check `innerWidth` after pinning.
- `voice`, `rate`, `pitch`, `volume`, `tts`, `subtitles` default to `.jig/video.json`; a key in `scenario.json` overrides it for this video.
- `voice`: an Edge TTS voice for the narration language (`edge-tts --list-voices`), e.g. `ru-RU-DmitryNeural`, `ru-RU-SvetlanaNeural`, `en-US-GuyNeural`. `rate` such as `+10%` shortens the whole video; `pitch` (`-5Hz`) and `volume` (`+10%`) work the same way. A step may set its own `rate`, `pitch`, `volume`. Edge TTS takes no SSML, so a pause inside a sentence comes only from punctuation (a full stop pauses longer than a comma) or from splitting the sentence into two steps.
- A step's `delay` (seconds) starts its narration and subtitle that much after the step starts: for a sentence that describes an action's result rather than the action.
- `subtitles`: `false` burns none; otherwise `{ "size": 18, "color": "#ffffff", "position": "bottom" | "top", "margin": 24 }`, every key optional (these are the defaults). `size` is in ASS units, 1/288 of the frame height. Each line sits on a translucent box. When a step's Proof is near the bottom edge (dialog buttons, a toolbar), use `top` or a larger `margin`.
