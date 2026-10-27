# Rank

**No cut: whatever survived verify reaches the author.** Ranking sets only the output order.

1. Heaviest first. Blocking findings ([verify](../gates/severity.md#blocking-finding)) go first: the author edits the rest after them.
2. `severity_class` sets the order when the project taxonomy has its own (`I1 → I2 → I3`, `N1 → N2`). A finding its vocabulary rated Important stays Important and is not demoted to cleanup by its angle. No project taxonomy → default: `correctness` beats cleanup, altitude and conventions.

Three filters, all before the comment texts:

- **Verify gates** ([step 05](05-verify.md)): a candidate is proven or refuted and does not exist.
- **Selector** ([selector](../references/selector.md)): a proven finding that matches no output token (a Nit of an angle run only for `important`) is not printed, written to state or posted; it counts in `tally.suppressed_selector`. `jig review-plan` prints the output filter.
- **Rework:** proven `Nit` and `Pre-existing` in files from `blocks` of a blocking finding that still stands (new in this run, or earlier with status `open`, `skipped`, `unverified`) go nowhere either, because their code goes under the rework; they count in `tally.suppressed_blocked`. A closed blocking finding mutes nothing: re-review reads its files again ([lifting `blocks`](09-rereview.md#round-rules)). `Important` in those files stays: the bug moves with the code unless someone says so. The skill has no third state "proven but did not fit".

A simplification (`status: "optional"`, [shape gate](../gates/shape.md#shape-gate)) is not ranked with findings: it is an item of the one FYI note, not a thread, and counts in `tally.optional`, not in `nit`.

## Merge per file

After the filters, findings of angle 16 (tests) and angle 17 (comments) in one file merge into one, separately per angle: `line` of the first instance, id `<file>:<line>:tests` or `<file>:<line>:comments`, one Nit in the tally. Wrong ones (`Important`) merge apart from the redundant ones: one Important per file and angle. A single instance in a file stays a normal finding. Text form: [comment texts](07-comments.md).

The outcome is `fixed` when every listed instance is fixed. Some remain: `skipped`.
