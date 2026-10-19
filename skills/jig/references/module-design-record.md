# Module design record

The page that ships with the sketch. One page, plain headings, no boilerplate. Replace each note in braces; drop a section you have nothing for, except the shapes considered. Terms follow `references/deep-modules.md`.

````markdown
## Problem

{One paragraph: what the change must do and what makes the shape non-obvious.}

## Constraints

- {A fact the design must honor, from grounding: an existing type to interoperate with, a caller that cannot break, an invariant, a stratum layer rule. Each with `file:line` or the rule name.}

## Usage

```typescript
{Two or three real call sites in the caller's code, written before the types: what it imports, what it calls, what comes back.}
```

## Shapes considered

| Shape | Interface (entry points) | What it hides | Why it lost |
| --- | --- | --- | --- |
| {name} | {count and one line} | {one line} | {one line, by depth, locality or seam placement} |

{At least two structurally different shapes. One viable shape only when the constraints forced it: say "the only viable shape because ...".}

## Chosen shape

{Data structures first, then how data flows through the signatures. Which invariants the types encode, where validation lives, what the module deliberately does not do. Depth: what the interface hides, what stays exposed and why it is no larger.}

## Grafts

- {What was taken from which losing candidate, and why.}

## Open risks

- {A risk or open question, phrased as a question.}

## Sketch

{Path of the sketch files (types, signatures, `not implemented` bodies) and the base candidate's location.}
````

The summary for the reply and the merge request: the chosen shape in one line, the strongest losing shape and why it lost, the sketch path.
