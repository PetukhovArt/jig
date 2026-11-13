---
name: jig-video
description: "Record a narrated demo video of a change's use cases by driving the running app."
disable-model-invocation: true
argument-hint: "<MR/PR url or number | commit range | use-cases list >"
---

# Feature video

`${CLAUDE_PLUGIN_ROOT}` is the plugin root when the agent sets it, otherwise the directory two levels above this file.

## Requirements

- `ffmpeg` with `ffprobe` (`winget install Gyan.FFmpeg`, `brew install ffmpeg`, `apt install ffmpeg`).
- A speech engine: `edge-tts` by default (`pipx install edge-tts` or `pip install edge-tts`; the `edge-tts` command or `python3`/`python`/`py -m edge_tts`), or any command set as `tts` in `.jig/video.json`.
- Project settings in `.jig/video.json` of the app checkout: the voice, the speech command, the handover. Format and setup: [references/setup.md](references/setup.md).
- The app's CDP port: from the `agent-view.config.json` of the app checkout, or `CDP_PORT`. The app exposes CDP (Electron, Tauri/WebView2, a browser).
- The OS layer (`scripts/window.mjs`): screen capture and window placement by title.
  - Windows: ffmpeg `gdigrab`, the `*.ps1` scripts through `powershell.exe`.
  - macOS: ffmpeg `avfoundation` (the main screen only), System Events through `osascript`. The terminal needs the Screen Recording and Accessibility permissions.
  - Linux: an X11 session (a Wayland session cannot be captured), ffmpeg `x11grab`, `wmctrl`, `xwininfo`, `xrandr`, `xprop` (`apt install wmctrl x11-utils x11-xserver-utils`), `fc-match` for the subtitle font.
- agent-view (`npm i -g @petukhovart/agent-view`) with `"allowEval": true` in `agent-view.config.json` (the cursor dot is drawn through `eval`).
- **No agent-view** (not installed and cannot be): `fv.mjs` drives the app over raw CDP; probes and limits in [references/no-agent-view.md](references/no-agent-view.md).

Pipeline: **feature list → scenario → rehearse → narrate → record → assemble**, one mp4 per change. The scenario is split into use cases: each is recorded as its own clip from its own start state, and `assemble` joins the clips into the one video. Stages from `scenario` on run as `node "${CLAUDE_PLUGIN_ROOT}/skills/jig-video/scripts/fv.mjs" <stage> <workdir>` from the app checkout: agent-view resolves the CDP port from that checkout's `agent-view.config.json`.

Workdir: `<os temp dir>/jig-video/<slug>/` (`node -p "require('os').tmpdir()"`) (`mr-413`, `pr-72`, `commits-8517ca73`). It holds `features.md`, `scenario.json` and everything the stages produce.

## Steps

1. **Check the dependencies.** Run `node "${CLAUDE_PLUGIN_ROOT}/skills/jig-video/scripts/fv.mjs" check`: it prints each requirement of this OS as `ok` or `MISS` with its install command or permission, and exits 1 when a required one is missing. Name the missing ones to the user and stop. With a custom `tts` the edge-tts line may be `MISS`: test the command with `fv.mjs say` instead. No `.jig/video.json` in the app checkout: run Setup from [references/setup.md](references/setup.md) first.
2. **Feature list.** Follow [references/feature-list.md](references/feature-list.md): find the project's changelog standard, derive the user-facing items from the MR/PR or diff, add how to show each one, and get the user's answer on the table. Everything after this step serves exactly these items.
3. **Get the app running on the change.** Find a checkout on the source branch (`git worktree list`). If its app answers `agent-view discover`, use it. Otherwise start it the way the project documents (its dev/CDP script; for parallel checkouts the `jig-slots` skill). Check that the app holds the data every `show` item needs. If it does not, look for the project's own emulator or mock (live values, a backend) and ask the user for a ready dataset before building one through the UI. A disposable project is the default: the demo may change it freely.
4. **Find a selector for every action** with `agent-view dom`, `eval`, `screenshot`, in this order (`--testid`, `--selector '[aria-label="…"]'` or `'[title="…"]'`, `-f <text>` only when that text is unique in the window). Canvas targets, and controls drawn on a canvas, take `--pos x,y` in CSS pixels of that window. A `--pos` holds only while the view stays put: in `setup` pin the window size (`window pin` in [references/scenario.md](references/scenario.md); a maximized window changes size with the monitor), hide the sidebars and set zoom and offset explicitly. `rehearse` saves the first window's viewport to `viewport.json`; `record` fails before capture when it differs. Done when every action has a selector you have seen resolve.
5. **Write `scenario.json`** (format: [references/scenario.md](references/scenario.md)). One use case per entry in `cases`, usually one per feature item or a few closely tied items. Every feature item maps to at least one step; a `narrate` item rides in a neighbouring step's `say`. Narration is in the language of the feature list, one or two sentences per step: what the viewer sees and what it gives the user. Aim for 45–90 s in total.
6. **Rehearse**: rehearse drives real windows: they open and move, so it takes the screen just like record. Both hold focus emulation on every page, so the app behaves as focused in the background: with a second monitor, pin the app there (`--secondary`) and the user keeps working on the first. Tell the user how long (about 1–2 min per run) and wait for their go-ahead; `eval`, `dom`, per-target `screenshot` and `narrate` do not need the screen. `fv.mjs rehearse <dir>` runs every case (`setup`, the case's `setup`, its steps) with no capture and no narration pauses. `--case <caseId>` runs one case; `--from <stepId>` restarts from a step, skipping its case's setup, and continues with the later cases. Take a screenshot after each step whose result is not obvious from the action. Done when two runs in a row pass from the start state and the screenshots show every item's Proof.
7. **Narrate**: `fv.mjs narrate <dir>` voices each step into `audio/<id>.<ext>` and writes `durations.json`. A line voiced before with the same text and voice settings is reused, so rerun it after any change to a `say` or a voice setting: only the changed lines are voiced again.
8. **Record.** Tell the user how long the run takes (sum of `durations.json` + 0.6 s per step + setup time, and per case about 5 s for ffmpeg to start and the 1 s tail) and wait for their go-ahead. Then `fv.mjs record <dir>` records each case into its clip `cases/<caseId>.mkv` and its step times into `marks.json`, saved after every case.
   - **Re-record**: when a case fails or its clip is bad, `--case <caseId>` re-records only it; the other clips stay.
   - **Area**: the default is the whole desktop (on macOS the main screen), right when the feature opens more windows. `--region x,y,w,h` takes physical pixels of the captured desktop (Windows: the virtual desktop, each monitor at its own scaling; macOS: the main screen); `--window "<exact title>"` captures one window's client area and keeps it topmost until capture stops (macOS raises it instead). Give every case the same area flags: a clip of another size gets borders.
   - **Leaks**: the capture grabs the screen, so whatever lies beneath the app (a terminal with the conversation, a messenger) is in the clip. With the whole desktop, `setup` lays the app windows out to cover the screen (`window place` in [references/scenario.md](references/scenario.md)); check the moments before the first window opens and after the last one closes. If something got in, mask it in the video and delete the clips in `cases/`, or tell the user the raw clips hold it.
9. **Assemble**: `fv.mjs assemble <dir>` fails while a case has no clip; otherwise it joins the clips in `cases` order and writes `video.mp4`: a 3 s title card from `title` and `subtitle`, then the clips with burned-in subtitles and the narration placed at each step's start, plus `timeline.json` with each step's start in the joined clips. Extract a frame from the title and from each step's Proof moment (`ffmpeg -ss <sec> -i video.mp4 -frames:v 1 f.png`, seconds = 3 + `timeline.json` value + a second) and look at them. Done when every frame shows its Proof and every click shows the cursor dot. When a still frame outlasts its sentence, run `speed-gaps.mjs` (Pace in [references/scenario.md](references/scenario.md)) and hand over `video-fast.mp4`.
10. **Hand over.** Give the user the path to the video, and send the file when the harness can send files to the user. Then `fv.mjs attach <dir> --to <MR/PR number or url> [--file video-fast.mp4] --dry-run` prints what the handover from `.jig/video.json` would do: a comment with the video on the MR (GitLab uploads API) or the PR (`gh`) (GitLab uploads API), or a copy to a folder. Run it without `--dry-run` only when the user asks to post: a comment on the PR/MR is public to its readers. The video is never committed.

## Gotchas

- agent-view without `--window` targets the first page target, which may be a pop-out. When the app has more than one window, pass `--window` on every action.
- `--window` matches a title substring and takes the first hit: `Demo` also matches `Trends — Demo`. Order the steps so an ambiguous title is used before its namesake opens, or pass the target id from `agent-view discover` (ids change per run, so only in probes and screenshots).
- Edge TTS (no `tts` set) is an online service that drops requests and throttles for minutes after a burst; `narrate` retries for about 3 min before failing. After such a failure, wait a few minutes before rerunning.
- A `wait` that times out fails the whole run. In `record` that costs a rerun of that case (`--case`), which is why rehearse comes first.
