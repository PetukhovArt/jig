# Severity

Every judge reads this file. Two parts with different owners:

- **taxonomy**: which defect classes are `Important` and which `Nit`. The project's severity sections (verbatim in your brief) exist → only they apply; the default below applies neither whole nor in parts. None → the [default](#default-taxonomy);
- **gates**: when severity is cut regardless of class. They always apply; a project cancels a gate only explicitly, by naming it.

`angles.<n>.severityCeiling` from the project config (named in your brief when set) stands over both: it sets the ceiling of that angle's findings, up or down.

## Default taxonomy

`Important`: the merge waits for the fix. Either behavior breaks, or the diff lays down a structure the next code will build on, and after the merge its fix gets dearer with every edit on top. The classes are closed; the class code in brackets:

- **Behavior:** broken behavior (`broken`), data loss (`data-loss`), crash (`crash`).
- **False guarantee** (`false-guarantee`, angles [16](../angles/16.tests.md) and [17](../angles/17.comments.md)): a test that cannot fail when the behavior it names breaks; a comment or doc comment the code contradicts. Nothing breaks now; the next edit is made on a guarantee that does not exist.
- **Layers and placement** (`layer`, [angle 13](../angles/13.architecture.md), sections A and B):
  - the direction or visibility of layers from the architecture document is broken: a lower layer imports an upper one (section B);
  - module internals through its boundary, an import bypassing the public index (section A);
  - a module in the wrong place: new code went into a module or layer that does not own the concept, while an owner is named (section A);
  - a dependency nothing uses: a dependency declared or a plugin or module registered, with no import or call in source (section A).
- **Spread across modules** (`spread`, angle 13):
  - a section A rule with a second participant in another module: duplicated ownership, a second copy of a responsibility, hidden coupling;
  - the code contradicts an ADR in force (section C): the decision is recorded, the code does otherwise, and the next reader will trust the document;
  - an `_Avoid_` synonym or a name differing from the glossary term (section D) in an exported symbol: a type, an event, an API field, a URL segment.
- **Structural smell** (`smell`, [angle 10](../angles/10.conventions.md) and the god object of section A): a structural smell from atom `smells` with a named second participant. A project vocabulary has its own scale, and it wins.

`Nit` (`nit`): worth fixing, does not block the merge. Everything outside the classes above: a section A rule with both participants in one module (except the god object), other smells, a glossary term in an internal symbol, a concept without an entry.

## Gates

The gate code in brackets.

- `Pre-existing` (`pre-existing`): lives in untouched lines of touched code; kept only with an Important class.
- A documentation finding (README drift, a broken link, a stale Markdown line): at most `Nit` (`docs`), whatever the focus note stresses. A code comment the code contradicts is not a documentation finding: see the next gate.
- Cleanup: `Nit` (`cleanup`), except a `CONFIRMED` memory leak ([angle 8](../angles/8.efficiency.md)), a wrong test ([angle 16](../angles/16.tests.md): cannot fail when the behavior it names breaks) and a wrong comment ([angle 17](../angles/17.comments.md): the code contradicts it). They follow the general rules; with the default taxonomy a wrong test or comment is `false-guarantee`.
- A secret in the diff ([angle 14](../angles/14.security.md)): `Important` with no input.
- A latent defect (fires only on a future edit): `Important` only when THIS diff sets the trap and the failure will be silent: no test, validation or error will catch it. Latent and loud, latent and pre-existing → `Nit` (`latent`) / `Pre-existing`.
- The angle ceiling from the config (`ceiling`).
- The focus directs attention, not severity. Rarity of the input does not lower severity: a bug that passed the rare gate gets the severity of its class.

## Class code

Two fields go with the severity:

- **`severity_class`**: the class code from the taxonomy in force: `I2`, `N3` for a project, `data-loss`, `nit` by default;
- **`severity_gate`**: the gate code, only when a gate cut the severity below the class level.

A class outside the taxonomy in force, or a severity below the class level without `severity_gate`, is a mismatch the orchestrator sends back. A judge gave `Nit` to erased user input that the project rated `I2`: nobody asked for the class, and the error showed only in the thread.

## Category

`category` is the slug of the angle that raised the candidate, one of nine: `correctness`, `security`, `reuse`, `simplification`, `efficiency`, `altitude`, `conventions`, `architecture`, `spec`. `docs`, `design`, `style`, `test-coverage` are not categories: documentation drift is `correctness` at Nit, a design smell is `altitude`, `simplification` or `architecture` with a broken rule. An angle that does not map means the candidate belongs to no angle: drop it.

## Blocking finding

An `Important` of angle 13 whose fix moves or rewrites code other findings stand on: logic moves to another module, a store splits. Return `blocks` (the files the fix rewrites) and name in `summary` where the code goes. No place named: no `blocks`, since without it nobody knows what to mute. What the output does with the neighbours: [ranking](../steps/06-rank.md).
