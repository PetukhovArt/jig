# Writing the focus note

Read when the invocation carries focus text, or the session established a focus in conversation. Path, resolution order and delivery: SKILL.md, "Focus note".

The focus belongs to the **session where the user aims the review**, not to one pass's arguments. It is stated once ("look for races in async flows, we recently caught duplicate requests") and every merge request of every later pass is reviewed under it. Neither a later pass nor a subagent inherits that conversation, so you **write it to the file**; the file, not the prompt, carries the intent forward. Only the main agent can write it: it alone holds the conversation.

**Write it before discovery.** A **distillation, not a transcript**: at most 5 bullets and 800 characters, each naming a risk class a finder can hunt ("navigation was rewritten: check that old deep links still resolve"). The same text reaches every merge request of every pass, and its length multiplies by merge requests × finders.

**Risk classes, not one merge request's context** ("races in async flows", "API contract compatibility"). A note that only makes sense for one merge request misdirects the finders on all the others, pass after pass, and nobody sees why the reports drifted. Context that narrow belongs in a direct `/jig-review <url> <focus>` run.

**Re-aiming a running loop needs no new schedule.** The user runs `/jig-review-cycle <new focus>` once by hand; that overwrites the file, and every later firing reads it. The focus never travels in the looped prompt.
