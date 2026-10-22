---
name: jig-grill
description: "Interview the user about a plan, a decision or an idea, walking its decision tree one question at a time until nothing is silently assumed."
disable-model-invocation: true
argument-hint: "<topic: a plan, a decision, an idea>"
---

# jig grill

`${CLAUDE_PLUGIN_ROOT}` is the plugin root when the agent sets it, otherwise the directory two levels above this file.

Read `${CLAUDE_PLUGIN_ROOT}/atoms/questions.md` and follow it for the whole interview.

1. Map the topic as a decision tree: every decision branches into the decisions that hang off it. Look up every fact in the code and the docs yourself before the first question.
2. Ask one question per reply, in the atom's format, starting from the decisions nothing else depends on. Wait for the answer: the user's choice is the point of the interview, so never answer your own question.
3. After each answer, add the branches it opened and drop the ones it closed. Re-ask nothing already settled.
4. Done when the frontier is empty: print every branch you opened and how it resolved, as **Settled** and **Open**.

Change nothing in the repository until the user confirms the shared understanding.
