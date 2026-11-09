---
name: ux
description: "Apply when you build, review or attack UI: components, markup, styles, screens. Values of any realistic size render readably, every state exists, numbers and time are formatted, every action is reachable, motion is fast and rare."
metadata:
  group: Design
---
# UX

The one UX criterion: build to it, review against it, attack with it. Worst-case values and failure signatures: `<root>/skills/jig/references/ux-catalog.md`; read it before you feed data or judge a layout.

- **Scope.** Check dark theme, RTL, touch, locales or a minimum width only when the project's code supports it (theme tokens, `dir`, `pointer: coarse`, an i18n library, breakpoints). Taste, a mismatch with a design reference, and dev-only UI are not UX defects.
- **Harm.** Broken: content cannot be read, an action cannot be reached, or wrong data shows (`NaN`, "1 members", a raw error). Ugly: usable but visibly wrong. Fragile: fine now, one realistic value from breaking (no limit, no fallback).
- **Data.** Only plausible values: a real naming pattern or the actual limit of the schema, column, API type or `maxLength`. No limit anywhere is Fragile. Feed them through the data boundary (fixture, mock, URL flag), never by editing markup.

## A. Layout under worst-case values

- Find the box owner first: walk up from the rendered value to the element that sets its size and overflow. A project wrapper or library component on the way: read its source (template, styles, props).
- The owner already guards the case: no defect. It guards it behind a prop the call site does not set: set the prop. The project solves this with a wrapper in two or more places and the change uses a raw element: use the wrapper, not new CSS. A defect inside an untouched wrapper is pre-existing.
- Per field: wrap what identifies an item; truncate at the end secondary text, with a way to read the whole; truncate in the middle what differs at the end (files, paths, hashes); clamp card previews; never truncate numbers, amounts or dates.

## B. States

- A view that waits for data has loading, empty and error states; a skeleton matches the final layout.
- An error says what happened and what to do, never a raw message or stack.
- A missing optional field is omitted or its space is reserved on purpose, never a stray `—`. No permission: hidden, or disabled with a reason, same layout.

## C. Formats

- Numbers, plurals, dates and relative time through `Intl` or the project's i18n; relative time turns absolute after about a week. Live numbers use `tabular-nums`. User text renders literally, escaped once.

## D. Reach

- A hover-only action has a touch and keyboard path when those are supported. A clickable element is a button or link, or has a role, `tabindex` and keys. Focus stays visible and returns to the opener after a modal closes. A destructive action has a confirmation or an undo.

## E. Motion

- An action used 100+ times a day, or started from the keyboard, gets no animation; occasional UI (modals, drawers, toasts) gets standard motion.
- Under 300 ms; `ease-out` to enter and exit, never `ease-in`; animate `transform` and `opacity` only, never `transition: all`; enter from `scale(0.95)`, never `scale(0)`; a popover scales from its trigger.
- `prefers-reduced-motion` keeps fades and drops movement. Motion never blocks input.
