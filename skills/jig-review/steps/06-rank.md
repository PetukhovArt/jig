# Rank

**No cut: whatever survived verify reaches the author.** Ranking sets only the output order.

1. Heaviest first.
2. `severity_class` sets the order when the project taxonomy has its own (`I1 → I2 → I3`, `N1 → N2`). A finding its vocabulary rated Important stays Important and is not demoted by its angle. No project taxonomy → default: `correctness` and `security` beat `spec`, `efficiency` and `conventions`.

Two filters, both before the comment texts:

- **Verify gates** ([step 05](05-verify.md)): a candidate is proven or refuted and does not exist.
- **Selector** ([selector](../references/selector.md)): a proven finding that matches no output token (a Nit of an angle run only for `important`) is not printed, written to state or posted; it counts in `tally.suppressed_selector`. `jig review-plan` prints the output filter.
