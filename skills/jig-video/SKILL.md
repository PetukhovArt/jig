---
name: jig-video
description: "Record a narrated demo video of a change's use cases by driving the running app."
disable-model-invocation: true
argument-hint: "<MR/PR url or number | commit range | use-cases list >"
---

# Feature video

`${CLAUDE_PLUGIN_ROOT}` is the plugin root when the agent sets it, otherwise the directory two levels above this file.

## Requirements

- `ffmpeg` (`winget install Gyan.FFmpeg`).
- `edge-tts` (Python): `pip install edge-tts`.
- The app's CDP port: from the `agent-view.config.json` of the app checkout, or `CDP_PORT`. The app exposes CDP (Electron, Tauri/WebView2, a browser).
- Windows. In v1 recording works only on Windows: `fv.mjs record` captures the screen with ffmpeg `gdigrab`, and the `*.ps1` scripts pin and lay out the windows.
- agent-view (`npm i -g @petukhovart/agent-view`) with `"allowEval": true` in `agent-view.config.json` (the cursor dot is drawn through `eval`).
- **No agent-view** (not installed and cannot be): `fv.mjs` drives the app over native CDP by itself, with the port from `agent-view.config.json` or `CDP_PORT`. Probes in steps 3–4 go through `node "${CLAUDE_PLUGIN_ROOT}/skills/jig-video/scripts/fv.mjs" cdp <verb> …` (`click`, `fill`, `wait`, `eval`, `drag`, `screenshot [file]`; `/json/list` on the port lists the windows). Selectors are limited to `--testid`, `--selector`, `-f`, `--pos`, and `drag` to `--from-pos/--to-pos`; refs from `dom`, `--scene` and HTML5 drag fail with an error naming that limit.

Pipeline: **feature list → scenario → rehearse → narrate → record → assemble**, one mp4 per change. The scenario is split into use cases: each is recorded as its own clip from its own start state, and `assemble` joins the clips into the one video. Stages from `scenario` on run as `node "${CLAUDE_PLUGIN_ROOT}/skills/jig-video/scripts/fv.mjs" <stage> <workdir>` from the app checkout: agent-view resolves the CDP port from that checkout's `agent-view.config.json`.

Workdir: `%TEMP%/jig-video/<slug>/` (`mr-413`, `pr-72`, `commits-8517ca73`). It holds `features.md`, `scenario.json` and everything the stages produce.

## Steps

1. **Check the dependencies.** Not on Windows: tell the user that recording works only on Windows in this version, and stop. Run `ffmpeg -version` and `python -m edge_tts --help`. Either is missing: name its install command from Requirements and stop.
2. **Feature list.** Follow [references/feature-list.md](references/feature-list.md): find the project's changelog standard, derive the user-facing items from the MR/PR or diff, add how to show each one, and get the user's answer on the table. Everything after this step serves exactly these items.
3. **Get the app running on the change.** Find a checkout on the source branch (`git worktree list`). If its app answers `agent-view discover`, use it. Otherwise start it the way the project documents (its dev/CDP script; for parallel checkouts the `jig-slots` skill). Check that the app holds the data every `show` item needs. If it does not, look for the project's own emulator or mock (live values, a backend) and ask the user for a ready dataset before building one through the UI. A disposable project is the default: the demo may change it freely.
4. **Find a selector for every action** with `agent-view dom`, `eval`, `screenshot`, in this order (`--testid`, `--selector '[aria-label="…"]'` or `'[title="…"]'`, `-f <text>` only when that text is unique in the window). Canvas targets, and controls drawn on a canvas, take `--pos x,y` in CSS pixels of that window. A `--pos` holds only while the view stays put: in `setup` pin the window size (`pin-window.ps1`, below; a maximized window changes size with the monitor), hide the sidebars and set zoom and offset explicitly. `rehearse` saves the first window's viewport to `viewport.json`; `record` fails before capture when it differs. Done when every action has a selector you have seen resolve.
5. **Write `scenario.json`** (format below). One use case per entry in `cases`, usually one per feature item or a few closely tied items. Every feature item maps to at least one step; a `narrate` item rides in a neighbouring step's `say`. Narration is in the language of the feature list, one or two sentences per step: what the viewer sees and what it gives the user. Aim for 45–90 s in total.
6. **Rehearse**: rehearse drives real windows: they open and move, so it takes the screen just like record. Both hold focus emulation on every page, so the app behaves as focused in the background: with a second monitor, pin the app there (`-Secondary`) and the user keeps working on the first. Tell the user how long (about 1–2 min per run) and wait for their go-ahead; `eval`, `dom`, per-target `screenshot` and `narrate` do not need the screen. `fv.mjs rehearse <dir>` runs every case (`setup`, the case's `setup`, its steps) with no capture and no narration pauses. `--case <caseId>` runs one case; `--from <stepId>` restarts from a step, skipping its case's setup, and continues with the later cases. Take a screenshot after each step whose result is not obvious from the action. Done when two runs in a row pass from the start state and the screenshots show every item's Proof.
7. **Narrate**: `fv.mjs narrate <dir>` synthesises `audio/<id>.mp3` per step and writes `durations.json`. Rerun it after any change to a `say` or a voice setting.
8. **Record.** Tell the user how long the run takes (sum of `durations.json` + 0.6 s per step + setup time and 5 s per case) and wait for their go-ahead. Then `fv.mjs record <dir>` records each case into its clip `cases/<caseId>.mkv` and its step times into `marks.json`, saved after every case.
   - **Re-record**: when a case fails or its clip is bad, `--case <caseId>` re-records only it; the other clips stay.
   - **Area**: the default is the whole desktop, right when the feature opens more windows. `--region x,y,w,h` takes physical pixels of the virtual desktop (each monitor at its own scaling); `--window "<exact title>"` captures one window's client area and keeps it topmost until capture stops. Give every case the same area flags: a clip of another size gets borders.
   - **Leaks**: `gdigrab` grabs the screen, so whatever lies beneath the app (a terminal with the conversation, a messenger) is in the clip. With the whole desktop, `setup` lays the app windows out to cover the screen (`place-windows.ps1`, below); check the moments before the first window opens and after the last one closes. If something got in, mask it in the video and delete the clips in `cases/`, or tell the user the raw clips hold it.
9. **Assemble**: `fv.mjs assemble <dir>` fails while a case has no clip; otherwise it joins the clips in `cases` order and writes `video.mp4`: a 3 s title card from `title` and `subtitle`, then the clips with burned-in subtitles and the narration placed at each step's start, plus `timeline.json` with each step's start in the joined clips. Extract a frame from the title and from each step's Proof moment (`ffmpeg -ss <sec> -i video.mp4 -frames:v 1 f.png`, seconds = 3 + `timeline.json` value + a second) and look at them. Done when every frame shows its Proof and every click shows the cursor dot. When a still frame outlasts its sentence, run `speed-gaps.mjs` (Pace, below) and hand over `video-fast.mp4`. Hand over the path to `video.mp4`, and attach the file when the harness can send files to the user.

## scenario.json

```json
{
  "title": "Scene and Trends in separate windows",
  "subtitle": "MR !41 · settings-dialog",
  "voice": "en-US-GuyNeural",
  "rate": "+0%",
  "setup": [
    ["run", "git", "-C", "<demo project>", "checkout", "<start commit>", "--", "scenes/demo.yaml"],
    ["run", "powershell.exe", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "${CLAUDE_PLUGIN_ROOT}/skills/jig-video/scripts/place-windows.ps1", "-Left", "Main"]
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
            ["run", "powershell.exe", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "${CLAUDE_PLUGIN_ROOT}/skills/jig-video/scripts/place-windows.ps1", "-Right", "Demo", "-WaitSec", "5"]
          ]
        }
      ]
    }
  ]
}
```

- `cases` run in order, each recorded as its own clip. Step ids are unique across all cases (`audio/<id>.mp3` is per step).
- **Start state.** Before every case run the scenario's `setup`, then the case's own `setup` (optional). `setup` brings the app to the common start state from any state the last run left: close its windows, reset the demo data (`run git checkout` of the changed files), hide the sidebars, set zoom, lay the windows out. A case's `setup` adds what this use case needs on top, e.g. the tab it starts from. So a case never depends on what the previous one left, any case can be recorded alone, and two runs in a row pass without cleanup. `teardown` (optional) runs after each case's capture stops, for data that is not disposable.
- `do` items are agent-view argv (`click`, `key`, `fill`, `drag`, `wait`, …; never `eval`: every action is one the user could take on an element they see), `["sleep", ms]`, or `["run", exe, …args]` for an OS command agent-view cannot do (placing a window, resetting a file); a non-zero exit fails the run. Before each `click` and `drag` a cursor dot glides to the target or the drag start, since CDP input moves no real cursor; a `drag --pointer` moves the dot along. A step whose Proof is that nothing happens (a read-only window) needs that visible attempt, or the frame shows nothing.
- **The cursor is mandatory**: every click in the video shows the dot. Only `click` and `drag` items draw it, so every UI action the viewer should see is a `click`/`drag` item. `["run", …, "agent-view", "act", "replay", …]` and a wrapper script that calls replay click with no dot: unroll a saved act script into its `click`/`fill`/`wait` items (the script's JSON lists the test ids). Keep `run` + replay only for actions off screen or in `setup`/`teardown`. A video without the dot cannot be fixed after recording: it is a re-recording.
- **Pace**: a replay runs at machine speed, so actions flash by. Give a visible action room: one action per item, a `["sleep", 800–1500]` after an action whose result the viewer must notice. The opposite failure is a long still frame: a step lasts until its slowest `wait` (a backend event, a reconnect), long after the sentence ended. Keep such waits in `setup` when the video does not need them, and after `assemble` run `node "${CLAUDE_PLUGIN_ROOT}/skills/jig-video/scripts/speed-gaps.mjs" <dir> [factor=3]`: it speeds up every stretch with no narration and keeps spoken parts at 1x, writing `video-fast.mp4` without re-recording.
- A step lasts as long as its actions or its narration, whichever is longer, plus 0.6 s. Narration starts with the step, so put the action the sentence describes first.
- `scripts/place-windows.ps1 -Left "<title>" -Right "<title>" [-SplitX <px>] [-WaitSec <s>]`: places windows by title (`-like` pattern) left and right of `-SplitX` physical pixels (default: half the screen); exits 1 when a title matches no window. A new window shows up where the OS put it and jumps into place a moment later; the jump is in the video.
- `scripts/pin-window.ps1 -Title "<exact title>" -Width <px> -Height <px> [-Secondary]`: restores the window and sets its client area to that size in physical pixels, at the top-left of the primary screen or of the other one. CSS pixels equal physical ones only at 100% scaling: check `innerWidth` after pinning.
- `voice`: an Edge TTS voice for the narration language (`python -m edge_tts --list-voices`), e.g. `ru-RU-DmitryNeural`, `ru-RU-SvetlanaNeural`, `en-US-GuyNeural`. `rate` such as `+10%` shortens the whole video; `pitch` (`-5Hz`) and `volume` (`+10%`) work the same way. A step may set its own `rate`, `pitch`, `volume`. Edge TTS takes no SSML, so a pause inside a sentence comes only from punctuation (a full stop pauses longer than a comma) or from splitting the sentence into two steps.
- A step's `delay` (seconds) starts its narration and subtitle that much after the step starts: for a sentence that describes an action's result rather than the action.
- `subtitles`: `false` burns none; otherwise `{ "size": 18, "color": "#ffffff", "position": "bottom" | "top", "margin": 24 }`, every key optional (these are the defaults). `size` is in ASS units, 1/288 of the frame height. Each line sits on a translucent box. When a step's Proof is near the bottom edge (dialog buttons, a toolbar), use `top` or a larger `margin`.

## Gotchas

- agent-view without `--window` targets the first page target, which may be a pop-out. When the app has more than one window, pass `--window` on every action.
- `--window` matches a title substring and takes the first hit: `Demo` also matches `Trends — Demo`. Order the steps so an ambiguous title is used before its namesake opens, or pass the target id from `agent-view discover` (ids change per run, so only in probes and screenshots).
- Edge TTS is an online service that drops requests and throttles for minutes after a burst; `narrate` retries for about 3 min before failing. After such a failure, wait a few minutes before rerunning.
- A `wait` that times out fails the whole run. In `record` that costs a rerun of that case (`--case`), which is why rehearse comes first.
