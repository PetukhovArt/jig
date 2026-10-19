---
name: writing-for-agents
description: "Apply when you write or edit text an agent runs on: a skill, a flow, an atom, a role, AGENTS.md or CLAUDE.md. Keep only lines that change what the agent does, give every step a checkable end, and put each meaning in one place."
metadata:
  group: Process
---
# Writing for agents

The goal is predictability: the agent takes the same process every run.

- The no-op test, sentence by sentence: does this line change behavior against the model's default? If not, delete the whole sentence. An intensifier ("be thorough") fails it too.
- Tell the agent what to do. Give the reason only when the rule is confusing without it.
- Prompt the positive target. A prohibition drags the forbidden behavior into context; keep one only as a hard guardrail, paired with what to do instead.
- Every step ends on a completion criterion the agent can check. A vague end ("understand the area") invites stopping early; sharpen it before anything else. Demanding criteria ("every caller accounted for") force the legwork.
- One meaning lives in one place. A copy drifts and inflates the meaning's weight; point to the source by path instead.
- The environment is a source of truth: scripts, config, directory layout, `--help`. Restate only what looking cannot find: the unwritten convention, the reason, the gotcha.
- A pointer (a description, an index line, a line naming a file) decides when the agent reads the material. Front-load its leading word, one trigger per case it covers, no synonyms for one case.
- Material every run needs sits inline; material only some cases reach sits behind a pointer. Split a file near 200 lines.
- Reuse a word the model already knows (tight, red, lever) over a coined term. Use one term per concept everywhere.
- Read the draft for what it leaves out: silence is delegated to the model's priors.
- A deterministic operation (validation, formatting, a repeated transform) becomes a script, not prose.
- A rule a check can enforce becomes the check (atom `lessons-to-checks`); the prose goes.
- Validate after editing: frontmatter has name and description, every referenced file and name exists.
- Prove a behavior change by running the agent on a task, not by rereading the text.
