---
name: prove-shippable
description: "Apply after completing a task, before declaring done. Verify against the real artifact (run the feature, read the actual value, inspect the diff), not a proxy, a self-report or 'it compiles'."
metadata:
  group: Proof
---
# Prove shippable

- Check the real thing: drive the running app as its user, run the command, read the stored value, open the produced file.
- A proxy is not proof: "the build passes", "the types check", "the subagent said done", "the test I wrote passes" without having seen it fail.
- A bug fix is proven by the same reproduction going from red to green on the same surface.
- Drive the app the way a user does: act on elements the user sees (test id, then accessible name, then visible text), wait for the visible end state, never sleep a fixed time.
- Reading state is fine for diagnosis; calling app code or dispatching events does not prove the feature works.
- When the check fails, suspect the observation method before the system: right instance, fresh build, right branch, right port.
- Make the check rerunnable: a saved UI scenario, a script or a test, so the next person proves it in one command.
