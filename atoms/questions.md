---
name: questions
description: "Apply before you ask the human anything, or when you interview them about a plan. Look facts up, settle observable forks by experiment, and ask only real choices, each with your recommendation and its vote split."
metadata:
  group: Process
---
# Questions

- **Fact**: one right answer in the code, the docs or a command output. Look it up. Never ask it.
- **Observable fork** ("which approach works", "is it fast enough", "does the layout fit"): build the smallest experiment that comes out differently for each option, run it, decide.
- **Choice**: a product or taste call no experiment settles. Ask it once, with the options and your recommendation.
- Ground before you recommend: a question touching code gets the producer and the consumer traced at `file:line` first. Never assume a shape of code you have not read.
- Name the principle each option strengthens or weakens instead of calling one "cleaner".
- Split your vote across the options in percent, summing to 100. A lopsided split says the choice is near-free; an even split marks a real fork. Derive it from the trade-off.
- A question whose answer depends on another open question waits until that one is answered.
- Ask in plain words. Never give the human a shorthand token to type back.

Format, one block per question:

```
❓ **Q1. <title>**: <the question, with the context the human needs> ➡️ <recommended option> 70%

2. <alternative> 20%
3. <alternative> 10%
```

An interview walks the decision tree: each answer opens the questions that hang off it. It ends when you can print the frontier, every branch you opened and how it resolved:

- **Settled**: each decision, the option chosen, the one-line reason.
- **Open**: each branch still unanswered, and what it waits on.
