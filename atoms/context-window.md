---
name: context-window
description: "Apply when context fills up: large outputs, long files, repeated reads, fan-out work. Route bulk reading to subagents and keep summaries, not raw payloads, in the main thread."
---
# Context window

- Bulk reading (many files, long logs, transcripts, wide searches) goes to a subagent. The main thread receives its verdict, not its dump.
- Read a range of a long file, not the whole file. Search first, then read the region.
- Give a subagent pointers (paths, commit, line ranges), not pasted content.
- One subagent per independent unit of work. A fix round or a retry goes to a fresh subagent with a consolidated brief, not to a resumed one.
- You own every subagent's output: check its diff or claims and write your own summary. Do not pass its text through.
- Cap scope per phase: name the files a phase may touch and stop when the phase is done.
