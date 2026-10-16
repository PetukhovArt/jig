# investigation

**You own the answer. Plan, route, write.**

Atoms: evidence, questions, context-window.

1. Frame the question in one line and say what would count as an answer.
2. How (for "how does X work", "where should Y live"): skip subagents for a one-file question. Otherwise spawn 2 to 4 subagents with role `explorer`, each on a distinct angle (entry points and call flow, data and state, boundaries and ownership, history of the area). Then one subagent with role `explainer` merges their findings into: Overview, Key concepts, How it works, Where things live (`file:line`), Gotchas.
3. Why (for "why is it like this", a regression, a decision): build the code anchor yourself first (`git log -L`, `git log -S`, `git blame`, the merge request behind the commit via `glab`/`gh`). Then one subagent with role `investigator` per evidence source you can reach (source control, merge requests and their threads, docs and ADRs), then one with role `synthesizer`. Unreachable sources are listed with the reason.
4. Answer in the how-shaped format, or as a recommendation with a trade-off table when the question asks what to do.
5. If the question rests on a wrong premise, say so and show the evidence.

Reply: the investigation output. For "are we sure?" give your own judgment with reasons. List what you could not check.
