# Feature list

The feature list is the contract of the video: every item is shown or narrated, and nothing outside it is. It lives in `<workdir>/features.md`.

## 1. Find the project's changelog standard

The project may already define how a change is told to its readers. Look, in order:

1. The pointers in `AGENTS.md` / `CLAUDE.md` (a line naming a changelog, release-notes or MR-description standard).
2. A search of the repo docs: `rg -il "changelog|release notes" --glob "*.md"` over `.ai/`, `docs/`, `CONTRIBUTING.md`, `.github/`, `.gitlab/`.

Found: its format, item types and writing rules govern the list. Not found: use the default format below.

## 2. Derive the items

- **MR / PR with a changelog block** already written in the project's format: take its items as they stand. Check each against the diff; an item the diff does not back is dropped and reported to the user.
- **No block, or a bare commit range**: read the diff (`git diff <base>...<head> --stat`, then the files behind each user-facing path) and write the items yourself under the standard's writing rules.

Each item is **what the user got**, one sentence in the product's language, with no file or symbol names. Types that a viewer can see (`feat`, `fix`, `perf`) become video items; team-only types (`refactor`, `docs`, `test`, `chore`) stay out.

## 3. Add the demo columns

For every item, fill:

- **Show**: the UI path that demonstrates it, taken from the MR's "how to test" section when it has one, else from the code (the entry point: menu label, button, route).
- **Proof**: what on screen proves the item (a new window, a value, a message). A viewer must see the difference, not infer it.
- **Mode**: `show` when the path is reachable in the running app with its current data, `narrate` when it needs something the demo cannot stage (second monitor, permissions, a crash condition). A `narrate` item gets one sentence in a neighbouring step.

## Default format

Used when the project has none:

```markdown
# <MR title>

| # | Type | Item | Show | Proof | Mode |
|---|------|------|------|-------|------|
| 1 | feat | Scene opens in a separate window | tab context menu → "Open in separate window" | a second window with the scene | show |
| 2 | fix | reopening a closed tab no longer shows an empty canvas | close tab, reopen | canvas renders | show |
```

Types: `feat` (new capability), `fix` (a bug the user felt), `perf` (a speed-up the user notices). 1 to 5 items; more than 5 means the video needs splitting per item group, ask the user.

## Done when

Every item has Show, Proof and Mode filled, and the user has seen the table and answered: edits applied, or approved as is.
