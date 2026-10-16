# A background agent prepares a slot

Provisioning a slot with a running app is minutes of tool calls whose intermediate output is noise: only the final "slot N ready on these ports" matters. Delegate it to a **background subagent** and keep the main session free. The steps it runs are in `app-slots.md`.

**The processes are not the agent's to hold.** The dev server and the browser/app instance outlive the agent that starts them, so never start them as a shell the agent owns: the handle dies with the agent and you get a "ready" report for a dead slot. The Bash tool's `run_in_background` is such a shell: a subagent's background processes are killed when it hands back.

- **Launch detached**: POSIX `setsid`/`nohup … &`. On Windows **do not type `start` into the Bash tool**: write a `.cmd` launcher instead (`app-slots.md`, Windows launch). The OS owns the lifetime, not the agent's shell.
- **Prove liveness by connecting, not by owning**: the agent's completion criterion is an *observation*: the dev port is LISTENing, the CDP port answers `/json/version`, and `agent-view` attaches. A launch that returned exit 0 proves nothing about a server that dies three seconds later.
- **Keep slot scratch out of the worktree**: launchers, logs, browser profiles go in `%TEMP%\jig-slots\<repo>-s<N>\` (POSIX: `/tmp/jig-slots/<repo>-s<N>/`), not next to the source. The worktree holds only the checkout plus what the project's own scripts write.
- **Redirect logs to a file in that scratch dir** (`<scratch>/slot-dev.log`): detached processes have no console to read afterwards, and it's the only way to diagnose a slot that came up wrong.
- **Name the window `slot<N> <worktreeDir> [<branch>] localhost:<devPort>`** (e.g. `slot4 frontend-s4-auth-fix [feat/auth-fix] localhost:3041`): a detached console on Windows gets renamed by `npx`/the bundler to `webpack`, so several slots give several identical windows. Slot number and port disambiguate machines; the worktree dir name and branch are what tell a *human* which task the window belongs to. The re-title recipe is in `app-slots.md`, Windows launch.

The agent returns a compact record: slot N, dir, branch, dev URL, CDP port, log path, and the sanity-check result. If liveness fails, it returns the tail of the log rather than retrying blind.

Teardown stays with whoever owns the task (`app-slots.md`, Teardown): the detached processes are not tracked by the session, so **kill them by port** before `jig slot rm <N>`, and never kill a port you did not provision.
