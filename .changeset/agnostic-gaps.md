---
"jig": patch
---

Agnostic gaps from the pre-release audit (#17):

- The project root comes from `JIG_PROJECT_DIR` under any agent, then the variable the agent's adapter names (Claude Code: `CLAUDE_PROJECT_DIR`), then the git top level.
- `jig review cost` says it reads Claude Code transcripts only when it finds no session.
- `jig doctor` suggests setting agent-view up only in a project with markup or style files.
- Review step examples name `<deep model>`, `<standard model>` and `<model A> → judge <model B>` instead of Claude model names.
- The slot references name the agent's shell and file-write tools instead of Claude Code's, launch detached with `nohup` on macOS, which has no `setsid`, and give the PowerShell form of the Windows launch.
- `jig-video` finds agent-view through `AGENT_VIEW_JS`, the global npm root or the `agent-view` command on `PATH`, so nvm-windows and volta installs work.
- `jig doctor` warns when `PATH` has no `node` (or one older than 20), which the hooks run bare; `docs/hooks.md` explains the macOS Dock and nvm case.
