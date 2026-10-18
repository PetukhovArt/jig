# ui-match

**You own matching the UI to a reference. The reference is the spec. You do not touch it.**

Atoms: prove-shippable, small-steps, shared-state, questions.

1. Name the reference and its tolerance. A design (Figma or another design tool, an image, a mockup): match within the project's tokens; a difference is allowed only when it is listed. An existing implementation (a migration, a port, another app): pixel-exact, a nonzero diff fails. No reference you can capture: `dash ask` for one, with the closest screen as the default.
2. Capture the reference before any change, at fixed viewport sizes and every state the reference shows (hover, active, disabled, empty, loading, error). A design: pull its structure (layout, typography, colors, variants, spacing) and an image of each node through the design tool's agent integration; no integration: ask the user for exports. An implementation: screenshots from a script you can rerun.
3. Never edit the reference, its captures or the capture script to make a comparison pass. The reference looks wrong: `dash ask`, keep working on the parts it does not touch.
4. Translate to the project before writing: map design tokens to project tokens, reuse existing components, use the assets from the reference instead of new icon packages or placeholders. A design value with no project token: the closest token, and list the difference.
5. One component at a time, shared primitives first. Parallel components go to separate slots (`jig-slots`), one owner each.
6. After each change, capture the same viewports and states on the running app (agent-view) and compare against the reference by image diff, side by side when no diff tool is available, never from memory. Check layout, spacing, typography, colors, assets and every interactive state. A design reference: done when every remaining difference is listed with its reason. An implementation reference: done at a zero diff.
7. Record each accepted difference with `dash decision "<difference>" --why "<token or platform reason>" --evidence "<capture path>"`. Differences go to the run page and the merge request, not into code comments.
8. `flows/mr.md`, one merge request per component or group. The description carries the reference link, the before and after captures and the list of differences.

Reply: the reference and its tolerance, the components done, the comparison result for each with the capture paths, the listed differences, what is left.
