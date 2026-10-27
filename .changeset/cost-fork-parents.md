---
"jig": patch
---

`jig review cost` puts the subagents of a runner subagent (finders, deepener, judge) under that runner, so one review of a merge request is one row and one record, and counts the history a fork copies from its parent once instead of once per fork.
