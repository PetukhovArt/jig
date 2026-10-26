---
name: jig-explain
description: "Explain the current topic visually: pseudocode, call trees, file trees, diagrams."
disable-model-invocation: true
---

Help the user understand the current topic of conversation visually. Skip the preamble and keep prose brief. Pick the smallest view that makes the key point clear.

- Show logic or an algorithm as pseudocode:

```text
on(save)
  if content is unchanged
    return cached result
  write new content
  return fresh result
```

  Pseudocode is for branching logic only. A lifecycle or a startup sequence (connect, retry, attach, quit, relaunch) reads badly as indented lines: the loop back is invisible. Show it as a `graph TD` of states with mermaid-ascii instead:

```text
┌─────────────────────────┐
│ connect to daemon socket│◄──────────────┐
└──────┬─────────┬────────┘               │
nobody listens   │connected               │
       ▼         ▼                        │
   spawn daemon   attach to a session     │
                  │                       │
              quit TUI                relaunch
                  ▼                       │
┌─────────────────────────┐               │
│ daemon keeps running    ├───────────────┘
└─────────────────────────┘
```

- Show runtime control flow as a call tree:

```text
submitForm
  createSession
    persistPrompt
    launchAgent
  navigateToSession
```

- Show UI structure as a component tree, including state and module boundaries that matter:

```tsx
<SessionPage> (apps/example/src/routes/session.tsx)
  useSessionEvents()
  <SessionToolbar>
    <RunSkillButton> (packages/ui)
```

- Show file responsibility or a broad refactor as a shallow file tree:

```text
src/
├── commands/       # parses user actions
├── sessions/       # owns session state
└── transport/      # sends API requests
```

- Show component interaction, control flow, or data flow with **mermaid-ascii**. Always run it, never hand-draw and never emit a ```mermaid block. It renders `graph` only, so express everything as a graph (`graph LR` / `graph TD`) and paste the raw output into a ```text block:

```
mermaid-ascii -f <temp dir>/graph.mmd
```

  Write the graph to that file with the agent's file-write tool first (`graph LR`, then `User-->|prompt|UI`, `UI-->|request|Daemon`, `Daemon-->|stream|UI`, one per line): a file works in every shell, where `printf … | mermaid-ascii` needs bash.

  No sequence diagrams: a message exchange is a graph with labelled edges, a lifecycle is a `graph TD` of states. Keep one graph under ~8 nodes; split otherwise. mermaid-ascii is optional. If the binary is missing, say so and give the install: prebuilt zips at https://github.com/AlexanderGrooff/mermaid-ascii/releases, or `go install github.com/AlexanderGrooff/mermaid-ascii@latest`. Then explain without the graph, using the other views.

- Use `diff` when the point is what changes and the surrounding shape already exists. Match the diff shape to the topic.

For a component change:

```diff
 <SessionPage>
   useSessionEvents()
   <SessionToolbar>
+    <RunSkillButton />
   <SessionTimeline>
+    <SkillResultCard />
```

For a file-layout change:

```diff
 src/
 ├── commands/
+│   └── show-me.ts       # expands the slash command
 ├── sessions/
-└── transport.ts
+└── transport/
+    ├── client.ts
+    └── stream.ts
```

For a call-tree or call-stack change:

```diff
 submitForm
   createSession
     persistPrompt
+    expandSkillMention
     launchAgent
-  navigateToSession
+  navigateToSession
+    subscribeToEvents
```

For a state or control-flow change:

```diff
 on(save)
-  write content
+  if content is unchanged
+    return cached result
+  write new content
+  invalidate cache
```

- Show the whole block when most of it is new, when omitted context would hide ownership or order, or when the user needs a copyable target shape:

```ts
function expandSkill(command: string): string {
  const skillName = command.slice(1)
  return `use the ${skillName} skill`
}
```

### guidance

Place each visual next to the short text it supports. Keep only the calls, files, props, states, and boundaries needed to answer the user's current question or the options to resolve the current discussion point.

You may use one of these, you may use several, it is unlikely you will use all of them. Use your judgement and don't overwhelm the user.
