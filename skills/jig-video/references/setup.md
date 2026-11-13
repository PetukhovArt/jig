# Project settings: `.jig/video.json`

The project's video choices, made once and tested, so later runs ask nothing. `fv.mjs` reads the first `.jig/video.json` from the app checkout up to the filesystem root; a key in `scenario.json` overrides it for that video. Commit the file: every teammate gets the same voice and the same handover.

```json
{
  "voice": "en-US-AndrewNeural",
  "rate": "+5%",
  "tts": "edge-tts --voice en-US-AndrewNeural --text {text} --write-media {out}.mp3",
  "subtitles": { "position": "top" },
  "attach": { "to": "github" }
}
```

| Key | Value |
|---|---|
| `voice`, `rate`, `pitch`, `volume` | Edge TTS settings, used when `tts` is not set (`edge-tts --list-voices`). |
| `tts` | Any speech command, run without a shell. `{out}` is the output path without extension: the command writes `{out}.<mp3, wav, ogg, m4a, …>`. `{text}` is the line; without `{text}` the line arrives on stdin. Quote with `"` or `'`. |
| `subtitles` | As in `scenario.json`. |
| `attach.to` | `github` (`gh pr comment --attach`), `gitlab` (the uploads API with the `glab` token or `GITLAB_TOKEN`, then a note on the MR), `local` (copy to `attach.dir`). Default: from the `origin` remote. |
| `attach.dir` | The folder for `local`, relative to the app checkout. |

A secret (an API key for a paid voice) never goes in the file: the `tts` command reads it from an environment variable the user sets.

## Setup

Run it when the app checkout has no `.jig/video.json`, or the user asks to change a choice. Ask the questions in one message, each with the recommended answer first:

1. **Voice engine**: Edge TTS (online, free, no key; recommended), the OS voice (macOS `say -o {out}.aiff {text}`, Linux `espeak-ng -w {out}.wav {text}`, Windows SAPI through a script the project ships), or a paid service through its CLI (ElevenLabs, OpenAI) with the key in an environment variable.
2. **Voice and language**: for Edge TTS, a voice for the narration language (`en-US-AndrewNeural`, `ru-RU-DmitryNeural`, …) and a `rate`.
3. **Handover**: post on the PR/MR (`github` or `gitlab`, from the `origin` remote), or copy to a folder (`local`), or hand over the path only (no `attach`).

Then test each choice:

- Voice: `fv.mjs say "<one sentence in the narration language>" <tmp>/sample`, and give the user the file to hear.
- Handover: `fv.mjs attach <dir> --to <PR/MR> --dry-run` on any video prints what would be posted.

Write `.jig/video.json` with the values as tested, and tell the user to commit it.
