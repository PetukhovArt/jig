# scenario.json

```json
{
  "title": "Scene and Trends in separate windows",
  "subtitle": "MR !41 · settings-dialog",
  "setup": [
    ["run", "git", "-C", "<demo project>", "checkout", "<start commit>", "--", "scenes/demo.yaml"],
    ["window", "place", "--left", "Main"]
  ],
  "cases": [
    {
      "id": "scene-window",
      "setup": [["click", "--window", "Main", "-f", "Demo"]],
      "steps": [
        {
          "id": "open-scene",
          "say": "A scene tab now opens in its own window from the tab menu.",
          "do": [
            ["click", "--window", "Main", "--right", "-f", "Demo"],
            ["click", "--window", "Main", "-f", "Open in separate window"],
            ["wait", "--window", "Demo", "--selector", "[title=\"Fit to window\"]"],
            ["window", "place", "--right", "Demo", "--wait", "5"]
          ]
        }
      ]
    }
  ]
}
```

- `cases` run in order, each recorded as its own clip. Step ids are unique across all cases (`audio/<id>.<ext>` is per step).
- **Start state.** Before every case run the scenario's `setup`, then the case's own `setup` (optional). `setup` brings the app to the common start state from any state the last run left: close its windows, reset the demo data (`run git checkout` of the changed files), hide the sidebars, set zoom, lay the windows out. A case's `setup` adds what this use case needs on top, e.g. the tab it starts from. So a case never depends on what the previous one left, any case can be recorded alone, and two runs in a row pass without cleanup. `teardown` (optional) runs after each case's capture stops, for data that is not disposable.
- `do` items are agent-view argv (`click`, `key`, `fill`, `drag`, `wait`, …; never `eval`: every action is one the user could take on an element they see), `["sleep", ms]`, `["window", "place" | "pin", …flags]`, or `["run", exe, …args]` for another command agent-view cannot do (resetting a file); a non-zero exit fails the run. A `run` item names a command every teammate's OS has (`git`, `node`), never `powershell.exe` or a shell script. Before each `click` and `drag` a cursor dot glides to the target or the drag start, since CDP input moves no real cursor; a `drag --pointer` moves the dot along. A step whose Proof is that nothing happens (a read-only window) needs that visible attempt, or the frame shows nothing.
- **The cursor is mandatory**: every click in the video shows the dot. Only `click` and `drag` items draw it, so every UI action the viewer should see is a `click`/`drag` item. `["run", …, "agent-view", "act", "replay", …]` and a wrapper script that calls replay click with no dot: unroll a saved act script into its `click`/`fill`/`wait` items (the script's JSON lists the test ids). Keep `run` + replay only for actions off screen or in `setup`/`teardown`. A video without the dot cannot be fixed after recording: it is a re-recording.
- **Pace**: a replay runs at machine speed, so actions flash by. Give a visible action room: one action per item, a `["sleep", 800–1500]` after an action whose result the viewer must notice. The opposite failure is a long still frame: a step lasts until its slowest `wait` (a backend event, a reconnect), long after the sentence ended. Keep such waits in `setup` when the video does not need them, and after `assemble` run `node "${CLAUDE_PLUGIN_ROOT}/skills/jig-video/scripts/speed-gaps.mjs" <dir> [factor=3]`: it speeds up every stretch with no narration and keeps spoken parts at 1x, writing `video-fast.mp4` without re-recording.
- A step lasts as long as its actions or its narration, whichever is longer, plus 0.6 s. Narration starts with the step, so put the action the sentence describes first.
- A window title in `window` items matches whole and case-insensitive, with `*` and `?` wildcards (`"*Demo"`). The same commands run by hand as `fv.mjs window place|pin …`.
- `["window", "place", "--left", "<title>", "--right", "<title>", "--split-x", "<px>", "--wait", "<s>"]` (each flag optional): places windows left and right of `--split-x` on the primary work area (default: half of it); fails when a title matches no window within `--wait`. A new window shows up where the OS put it and jumps into place a moment later; the jump is in the video.
- `["window", "pin", "--title", "<title>", "--width", "<px>", "--height", "<px>", "--secondary"]`: restores the window and sets its client area to that size, at the top-left of the primary screen's work area or of the other screen. The size is in physical pixels on Windows and Linux and in points on macOS; CSS pixels equal it only at 100% scaling: check `innerWidth` after pinning.
- `voice`, `rate`, `pitch`, `volume`, `tts`, `subtitles` default to `.jig/video.json`; a key in `scenario.json` overrides it for this video.
- `voice`: an Edge TTS voice for the narration language (`edge-tts --list-voices`), e.g. `ru-RU-DmitryNeural`, `ru-RU-SvetlanaNeural`, `en-US-GuyNeural`. `rate` such as `+10%` shortens the whole video; `pitch` (`-5Hz`) and `volume` (`+10%`) work the same way. A step may set its own `rate`, `pitch`, `volume`. Edge TTS takes no SSML, so a pause inside a sentence comes only from punctuation (a full stop pauses longer than a comma) or from splitting the sentence into two steps.
- A step's `delay` (seconds) starts its narration and subtitle that much after the step starts: for a sentence that describes an action's result rather than the action.
- `subtitles`: `false` burns none; otherwise `{ "size": 18, "color": "#ffffff", "position": "bottom" | "top", "margin": 24 }`, every key optional (these are the defaults). `size` is in ASS units, 1/288 of the frame height. Each line sits on a translucent box. When a step's Proof is near the bottom edge (dialog buttons, a toolbar), use `top` or a larger `margin`.
