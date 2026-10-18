# visual-match

**You own pixel-exact equivalence. The baseline is the spec. You do not touch it.**

Atoms: prove-shippable, small-steps.

1. Fix the baseline first: screenshots of the reference (the old implementation, or the design export) taken by a script you can rerun, at fixed viewport sizes and states.
2. Never edit the baseline or the screenshot harness to make a diff pass.
3. Work one component at a time; shared primitives first.
4. After each change, capture the same states and diff against the baseline. Done for a component when the diff is zero or every remaining difference is listed and accepted by the user.
5. `flows/mr.md`, one merge request per component or group.

Reply: the components migrated, the diff result for each, where the baseline and harness live, what is left.
